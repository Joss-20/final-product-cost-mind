# modal_app.py — Modal >= 0.62 style
import os, time, io, requests
from typing import Optional, List
import modal

from modal import App, Image, Secret, asgi_app

# --- Modal image with Python deps your app needs ---
image = (
    Image.debian_slim()
    .pip_install(
        "fastapi==0.111.0",
        "uvicorn==0.30.0",
        "pydantic==2.8.2",
        "httpx==0.27.0",
        "numpy==1.26.4",
        "pandas==2.2.2",
        "python-multipart",          # for file uploads
        "supabase==2.6.0",
        "scikit-learn==1.5.1",
        "requests==2.32.3",
    )
)

app = App("ml-service")
supabase_secret = Secret.from_name("Supabase")

# --- Tiny demo model ---
import numpy as np
class DummyModel:
    def predict(self, X):
        return np.array([float(sum(row)) * 0.1 for row in X])

MODEL_NAME = os.environ.get("MODEL_NAME", "demo-regressor")
FEATURE_COLUMNS: List[str] = [
    c.strip() for c in os.environ.get("FEATURE_COLUMNS", "f1,f2,f3").split(",") if c.strip()
]

_model = None
def load_model_once():
    global _model
    if _model is None:
        # TODO: replace with your real model loader
        _model = DummyModel()
    return _model

# --- Auth helpers (Supabase JWT) ---
def verify_supabase_jwt(authorization: Optional[str]) -> Optional[str]:
    supabase_url = os.environ.get("SUPABASE_URL")
    anon_key = os.environ.get("SUPABASE_ANON_KEY")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    if not supabase_url:
        return None

    jwt = authorization.split(" ", 1)[1]
    headers = {"Authorization": f"Bearer {jwt}"}
    # Supabase Auth API requires an apikey header
    if anon_key:
        headers["apikey"] = anon_key
    elif service_key:
        headers["apikey"] = service_key

    try:
        r = requests.get(f"{supabase_url}/auth/v1/user", headers=headers, timeout=5)
        if r.status_code == 200:
            return r.json().get("id")
    except Exception:
        pass
    return None

# --- Usage logging (service role) ---
def log_usage(user_id: str, endpoint: str, inputs, outputs, latency_ms: int, cost_usd: float = 0.0):
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (supabase_url and service_key):
        return
    try:
        requests.post(
            f"{supabase_url}/rest/v1/usage_logs",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={
                "user_id": user_id,
                "model_name": MODEL_NAME,
                "endpoint": endpoint,
                "inputs": inputs,
                "outputs": outputs,
                "latency_ms": latency_ms,
                "cost_usd": float(cost_usd),
                # "project_id": os.environ.get("PROJECT_ID"),  # optional multi-tenant
            },
            timeout=4,
        )
    except Exception:
        pass

# --- FastAPI inside Modal function ---
@app.function(image=image, secrets=[supabase_secret])
@asgi_app()
def fastapi_app():
    import pandas as pd
    from typing import List, Optional
    from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File
    from fastapi.responses import StreamingResponse
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel

    api = FastAPI(title="ML Service on Modal", version="0.1.0")

    # CORS (add your Vercel domain)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            os.environ.get("FRONTEND_ORIGIN", ""),   # set this env to your Vercel URL
        ],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    class PredictIn(BaseModel):
        inputs: list[list[float]]

    class PredictOut(BaseModel):
        outputs: list[float]

    def authenticate(authorization: Optional[str] = Header(None)) -> str:
        user_id = verify_supabase_jwt(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return user_id

    @api.get("/health")
    def health():
        load_model_once()
        return {"ok": True, "model": MODEL_NAME, "feature_columns": FEATURE_COLUMNS}

    @api.get("/whoami")
    def whoami(user_id: str = Depends(authenticate)):
        return {"user_id": user_id}

    @api.post("/predict", response_model=PredictOut)
    def predict(payload: PredictIn, user_id: str = Depends(authenticate)):
        mdl = load_model_once()
        t0 = time.time()
        yhat = mdl.predict(payload.inputs).tolist()
        latency = int((time.time() - t0) * 1000)
        log_usage(user_id, "/predict", {"n": len(payload.inputs)}, {"n": len(yhat)}, latency)
        return {"outputs": yhat}

    # ------ CSV batch with schema guard ------
    def df_to_X(df: "pd.DataFrame", expected_cols: List[str]) -> list[list[float]]:
        missing = [c for c in expected_cols if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {missing}. "
                       f"Expected: {expected_cols}. Found: {list(df.columns)}"
            )
        sub = df.loc[:, expected_cols].apply(pd.to_numeric, errors="coerce")
        if sub.isnull().to_numpy().any():
            sub = sub.fillna(0.0)  # or raise a 400 if you prefer strict mode
        return sub.to_numpy().tolist()

    @api.post("/predict_csv")
    async def predict_csv(file: UploadFile = File(...), user_id: str = Depends(authenticate)):
        mdl = load_model_once()
        if not file.filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="Please upload a .csv file.")

        raw = await file.read()
        try:
            df = pd.read_csv(io.BytesIO(raw))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

        X = df_to_X(df, FEATURE_COLUMNS)

        t0 = time.time()
        yhat = mdl.predict(X).tolist()
        latency = int((time.time() - t0) * 1000)

        out = df.copy()
        out["prediction"] = yhat
        buf = io.StringIO()
        out.to_csv(buf, index=False)
        csv_bytes = buf.getvalue().encode("utf-8")

        log_usage(
            user_id,
            "/predict_csv",
            {"rows": int(getattr(df, "shape", [0])[0])},
            {"rows": len(yhat)},
            latency,
        )

        headers = {
            "Content-Disposition": 'attachment; filename="predictions.csv"',
            "X-Model-Name": MODEL_NAME,
        }
        return StreamingResponse(io.BytesIO(csv_bytes), media_type="text/csv", headers=headers)

    return api
