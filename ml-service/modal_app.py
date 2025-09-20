# modal_app.py — Modal >= 0.62, safe local imports
import os
from modal import App, Image, asgi_app, Secret

image = (
    Image.debian_slim()
    .pip_install(
        "pandas==2.2.2",
        "joblib==1.4.2",
        "fastapi==0.111.0",
        "uvicorn==0.30.0",
        "pydantic==2.8.2",
        "requests==2.32.3",
        "httpx==0.27.0",
        "numpy==1.26.4",
        "supabase==2.6.0",
        "scikit-learn==1.5.1",
    )
)

APP_NAME = os.environ.get("APP_NAME", "ml-service")
SUPABASE_SECRET_NAME = os.environ.get("SUPABASE_SECRET_NAME", "Supabase")

app = App(APP_NAME)

# If your secret is named differently, match it here exactly (case-sensitive).
supabase_secret = Secret.from_name(SUPABASE_SECRET_NAME)

@app.function(image=image, secrets=[supabase_secret])
@asgi_app()
def fastapi_app():
    import time
    from typing import Optional
    import requests
    from fastapi import FastAPI, Depends, HTTPException, Header, UploadFile, File
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import Response
    from pydantic import BaseModel
    import pandas as pd
    import numpy as np  

    SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")  # add this to your secret
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    PROJECT_ID = os.environ.get("PROJECT_ID") #eg. uuid per client
    MODEL_URL = os.environ.get("MODEL_URL")      # e.g. "s3://my-bucket/path/to/model.joblib"
    MODEL_NAME = os.environ.get("MODEL_NAME", "demo-regressor")
    FEATURE_COLUMNS = os.environ.get("FEATURE_COLUMNS")  # e.g. "f1,f2,f3"

    # ---- tiny demo model ----
    class DummyModel:
        def predict(self, X):
            return [float(sum(row)) * 0.1 for row in X]

    STATE = {"model": None}
    def load_model_once():
        if STATE["model"] is None:
            STATE["model"] = DummyModel()
        return STATE["model"]

    # ---- auth via Supabase JWT (now sends apikey header) ----
    def verify_supabase_jwt(authorization: Optional[str]) -> Optional[str]:
        if not authorization or not authorization.lower().startswith("bearer "):
            return None
        if not SUPABASE_URL:
            return None
        jwt = authorization.split(" ", 1)[1]
        headers = {"Authorization": f"Bearer {jwt}"}
        if SUPABASE_ANON_KEY:
            headers["apikey"] = SUPABASE_ANON_KEY
        elif SUPABASE_SERVICE_ROLE_KEY:
            headers["apikey"] = SUPABASE_SERVICE_ROLE_KEY
        try:
            r = requests.get(f"{SUPABASE_URL}/auth/v1/user", headers=headers, timeout=5)
            if r.status_code == 200:
                return r.json().get("id")
        except Exception:
            pass
        return None

    def authenticate(authorization: Optional[str] = Header(None)) -> str:
        user_id = verify_supabase_jwt(authorization)
        if not user_id:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return user_id

    # ---- feature selection helper ----
    def df_to_X(df: pd.DataFrame) -> np.ndarray:
        if FEATURE_COLUMNS:
            cols = [c.strip() for c in FEATURE_COLUMNS.split(",") if c.strip()]
            missing = [c for c in cols if c not in df.columns]
            if missing:
                raise HTTPException(status_code=400, detail=f"Missing columns: {missing}")
            X = df[cols].astype(float, errors="raise").to_numpy()
        else:
            # fallback: use all numeric columns in the CSV
            num = df.select_dtypes(include=["number"])
            if num.empty:
                raise HTTPException(status_code=400, detail="No numeric columns found.")
            X = num.astype(float, errors="raise").to_numpy()
        return X
    
    # ---- optional usage logging ----
    def log_usage(user_id: str, endpoint: str, inputs, outputs, latency_ms: int, cost_usd: float = 0.0):
        if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
            return
        try:
            requests.post(
                f"{SUPABASE_URL}/rest/v1/usage_logs",
                headers={
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "user_id": user_id,
                    "project_id": PROJECT_ID,
                    "model_name": MODEL_NAME,
                    "endpoint": endpoint,
                    "inputs": inputs,
                    "outputs": outputs,
                    "latency_ms": latency_ms,
                    "cost_usd": float(cost_usd),
                },
                timeout=4,
            )
        except Exception:
            pass

    # ---- FastAPI ----
    api = FastAPI(title="ML Service on Modal", version="0.1.0")
    api.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",           # Streamlit local
        "https://vercel.com/jose-juan-lazcanos-projects/final-product-cost-mind/EecaSXZNFuab9pzpHkaVj5sNqhPQ", # vercel
        "https://www.costmind.ai" # prod
    ],
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["Authorization","Content-Type"],
)


    class PredictIn(BaseModel):
        inputs: list[list[float]]

    class PredictOut(BaseModel):
        outputs: list[float]

    @api.get("/health")
    def health():
        load_model_once()
        return {"ok": True, "model": MODEL_NAME}

    @api.get("/whoami")
    def whoami(user_id: str = Depends(authenticate)):
        return {"user_id": user_id}

    @api.post("/predict", response_model=PredictOut)
    def predict(payload: PredictIn, user_id: str = Depends(authenticate)):
        model = load_model_once()
        t0 = time.time()
        yhat = model.predict(payload.inputs)
        latency = int((time.time() - t0) * 1000)
        log_usage(user_id, "/predict", {"n": len(payload.inputs)}, {"n": len(yhat)}, latency)
        return {"outputs": yhat}
    
    @api.post("/predict_csv")
    def predict_csv(file: UploadFile = File(...), user_id: str = Depends(authenticate)):
        model = load_model_once()
        t0 = time.time()
        # Read CSV
        df = pd.read_csv(file.file)
        # Select features
        X = df_to_X(df)
        # Predict
        preds = model.predict(X)
        preds = preds.tolist() if hasattr(preds, "tolist") else list(preds)
        # Append predictions and return CSV
        out = df.copy()
        out["prediction"] = preds
        csv_bytes = out.to_csv(index=False).encode("utf-8")
        latency = int((time.time() - t0) * 1000)
        log_usage(user_id, "/predict_csv", {"n_rows": len(df)}, {"n_preds": len(preds)}, latency)
        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="predictions.csv"'},
        )

    return api



