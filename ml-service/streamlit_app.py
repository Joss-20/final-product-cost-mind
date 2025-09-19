import os, time, io, json, datetime as dt
import pandas as pd
import requests
import streamlit as st
from supabase import create_client

# ---------- Page config ----------
st.set_page_config(page_title="Client Portal", layout="wide")

# ---------- Resilient config loader (Option C) ----------
def _val(k: str):
    if k in st.secrets: return st.secrets[k]
    v = os.environ.get(k)
    if v: return v
    try:
        from dotenv import load_dotenv
        load_dotenv()
        return os.environ.get(k)
    except Exception:
        return None

SB_URL  = _val("SUPABASE_URL")
SB_ANON = _val("SUPABASE_ANON_KEY")
API     = _val("MODAL_API_BASE")
PROJECT_ID = _val("PROJECT_ID")

missing = [k for k,v in {"SUPABASE_URL":SB_URL,"SUPABASE_ANON_KEY":SB_ANON,"MODAL_API_BASE":API,"PROJECT_ID": PROJECT_ID}.items() if not v]
if missing:
    st.sidebar.header("Configuration")
    SB_URL  = st.sidebar.text_input("SUPABASE_URL",  SB_URL or "")
    SB_ANON = st.sidebar.text_input("SUPABASE_ANON_KEY", SB_ANON or "", type="password")
    API     = st.sidebar.text_input("MODAL_API_BASE", API or "")
    if st.sidebar.button("Use these settings"):
        st.session_state.cfg = {"SUPABASE_URL":SB_URL,"SUPABASE_ANON_KEY":SB_ANON,"MODAL_API_BASE":API}
        st.rerun()
    if "cfg" in st.session_state:
        SB_URL  = st.session_state.cfg["SUPABASE_URL"]
        SB_ANON = st.session_state.cfg["SUPABASE_ANON_KEY"]
        API     = st.session_state.cfg["MODAL_API_BASE"]
    else:
        st.stop()

# ---------- Supabase client ----------
@st.cache_resource(show_spinner=False)
def sb(url: str, anon: str):
    return create_client(url, anon)

client = sb(SB_URL, SB_ANON)

def api_call(path, token=None, method="GET", json=None, files=None, timeout=60):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if files is None and json is not None:
        headers["Content-Type"] = "application/json"
    r = requests.request(method, f"{API}{path}", headers=headers, json=json, files=files, timeout=timeout)
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code}: {r.text}")
    return r

# ---------- UI header ----------
st.title("ML Client Portal")

# Settings box (shows current config + feature column settings)
with st.expander("Settings / Connection", expanded=False):
    st.write("**Modal API:**", API)
    st.write("**Supabase Project:**", SB_URL)
    # Feature columns are for UI only (backend can also validate)
    default_cols = "f1,f2,f3"
    feature_cols_str = st.text_input("Feature columns (comma-separated)", value=st.session_state.get("feature_cols_str", default_cols))
    st.session_state.feature_cols_str = feature_cols_str
    feature_cols = [c.strip() for c in feature_cols_str.split(",") if c.strip()]
    st.caption(f"Expecting {len(feature_cols)} features per row: {feature_cols}")

# ---------- Auth ----------
if "auth" not in st.session_state:
    st.session_state.auth = None

if not st.session_state.auth:
    st.subheader("Sign in")
    email = st.text_input("Email")
    pwd = st.text_input("Password", type="password")
    if st.button("Sign in"):
        try:
            res = client.auth.sign_in_with_password({"email": email, "password": pwd})
            st.session_state.auth = {"id": res.user.id, "token": res.session.access_token, "email": res.user.email}
            st.success("Signed in")
            st.rerun()
        except Exception as e:
            st.error(f"Login failed: {e}")
    st.stop()

# ---------- Top widgets: health & whoami ----------
cols = st.columns(2)
with cols[0]:
    st.caption("Service health")
    try:
        st.json(api_call("/health").json())
    except Exception as e:
        st.error(f"Health failed: {e}")

with cols[1]:
    st.caption("Who am I")
    try:
        st.json(api_call("/whoami", token=st.session_state.auth["token"]).json())
    except Exception as e:
        st.error(f"Auth check failed: {e}")

# ---------- Single prediction ----------
st.header("Single / Small-batch Predictions")
if "pred_history" not in st.session_state:
    st.session_state.pred_history = []  # store small predictions to export later

n_rows = st.number_input("Rows", 1, 50, 1, help="How many rows to predict at once")
# Build inputs grid using feature names
inputs = []
with st.form("single_predict_form"):
    for i in range(int(n_rows)):
        sub = st.columns(len(feature_cols))
        row_vals = []
        for j, name in enumerate(feature_cols):
            row_vals.append(sub[j].number_input(f"{name} [{i}]", key=f"in_{i}_{name}", value=0.0))
        inputs.append(row_vals)
    submitted = st.form_submit_button("Predict")
    if submitted:
        try:
            t0 = time.time()
            resp = api_call("/predict", token=st.session_state.auth["token"], method="POST", json={"inputs": inputs})
            out = resp.json()["outputs"]
            latency = int((time.time()-t0)*1000)
            st.success({"latency_ms": latency, "outputs": out})
            # Record to local history for CSV export
            ts = dt.datetime.utcnow().isoformat()
            for row, y in zip(inputs, out):
                st.session_state.pred_history.append({"timestamp": ts, **{c:v for c,v in zip(feature_cols,row)}, "prediction": y})
        except Exception as e:
            st.error(f"Predict failed: {e}")

# Export local single-pred history to CSV
if st.session_state.pred_history:
    df_hist = pd.DataFrame(st.session_state.pred_history)
    st.download_button(
        "⬇️ Download single-prediction history (CSV)",
        data=df_hist.to_csv(index=False).encode("utf-8"),
        file_name="single_prediction_history.csv",
        mime="text/csv",
        help="All single/small predictions from this session."
    )
    st.dataframe(df_hist.tail(20), use_container_width=True)

# ---------- Batch CSV prediction ----------
st.header("Batch Predictions (CSV)")
left, right = st.columns([2,1])
with left:
    uploaded = st.file_uploader("Upload a CSV with your feature columns", type=["csv"])
    if uploaded is not None:
        try:
            df_in = pd.read_csv(uploaded)
            st.caption(f"Preview of {uploaded.name} — {df_in.shape[0]} rows, {df_in.shape[1]} columns")
            st.dataframe(df_in.head(15), use_container_width=True)
            # Optional validation client-side
            missing = [c for c in feature_cols if c not in df_in.columns]
            if missing:
                st.warning(f"Missing expected columns: {missing} — server will error if FEATURE_COLUMNS is enforced.")
        except Exception as e:
            st.error(f"Could not read CSV: {e}")

with right:
    st.caption("Need an example?")
    example = pd.DataFrame({"f1":[0.5,-1.2,2.0,0.0,1.1],"f2":[1.0,0.3,-0.7,2.2,-1.4],"f3":[-0.2,0.8,1.3,-1.0,0.0]})
    st.download_button("Download sample.csv", example.to_csv(index=False).encode("utf-8"), "sample.csv", "text/csv")

if uploaded is not None and st.button("Run batch prediction"):
    try:
        files = {"file": (uploaded.name, uploaded.getvalue(), "text/csv")}
        r = api_call("/predict_csv", token=st.session_state.auth["token"], method="POST", files=files, timeout=180)
        csv_bytes = r.content
        # inline preview
        try:
            df_out = pd.read_csv(io.BytesIO(csv_bytes))
            st.success(f"Predicted {len(df_out)} rows.")
            st.dataframe(df_out.head(15), use_container_width=True)
        except Exception:
            st.info("Preview unavailable, but download is ready.")
        st.download_button("⬇️ Download predictions.csv", data=csv_bytes, file_name="predictions.csv", mime="text/csv")
    except Exception as e:
        st.error(f"Batch predict failed: {e}")

# ---------- Metrics ----------
st.header("Metrics & Usage")
try:
    # Pull last 1000 rows (adjust as needed)
    data = client.table("usage_logs").select("created_at, latency_ms, cost_usd").eq("project_id", PROJECT_ID).order("created_at", desc=True).limit(1000).execute().data
    df = pd.DataFrame(data)
    if df.empty:
        st.info("No usage yet.")
    else:
        df["created_at"] = pd.to_datetime(df["created_at"])
        df["day"] = df["created_at"].dt.date
        # KPIs
        total = len(df)
        today = df[df["created_at"].dt.date == dt.date.today()]
        p95 = int(df["latency_ms"].quantile(0.95)) if "latency_ms" in df else None
        cost = float(df.get("cost_usd", pd.Series([0]*len(df))).sum())
        k1,k2,k3,k4 = st.columns(4)
        k1.metric("Total requests", f"{total}")
        k2.metric("Today", f"{len(today)}")
        k3.metric("p95 latency (ms)", f"{p95 if p95 is not None else '—'}")
        k4.metric("Cost ($)", f"{cost:,.4f}")
        # Charts
        grp = df.groupby("day").agg(reqs=("created_at","count"),
                                    p95_latency=("latency_ms", lambda s: int(pd.Series(s).quantile(0.95)) if len(s) else 0),
                                    cost=("cost_usd","sum")).reset_index()
        st.subheader("Requests per day")
        st.bar_chart(grp.set_index("day")["reqs"])
        st.subheader("p95 latency (ms)")
        st.line_chart(grp.set_index("day")["p95_latency"])
        st.subheader("Cost ($)")
        st.area_chart(grp.set_index("day")["cost"])
except Exception as e:
    st.warning(f"Metrics unavailable: {e}")
