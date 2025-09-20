# modal_app.py
import os, time, requests
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Header
from pydantic import BaseModel
import modal

# --- Modal image with Python deps your app needs ---
image = (
    modal.Image.debian_slim()
    .pip_install(
        "fastapi==0.111.0",
        "uvicorn==0.30.0",
        "pydantic==2.8.2",
        "httpx==0.27.0",
        "numpy==1.26.4",
        "supabase==2.6.0",
        "scikit-learn==1.5.1"
    )
)

app = modal.App("ml-service")

# --- Secrets: create these in step 3 so they appear as env vars ---
@app.function(secrets=[modal.Secret.from_name("Supabase")])
def f():
    print(os.environ["MODEL_NAME"])  # e.g. "demo-regressor"

# --- Tiny demo model ---
import numpy as np
class DummyModel:
    def predict(self, X):
        return np.array([float(sum(row)) * 0.1 for row in X])

MODEL_NAME = os.environ.get("MODEL_NAME", "demo-regressor")
model = None
def load_model_once():
    global model
    if model is None:
        model = DummyModel()
    return model

# --- Auth helpers (JWT via Supabase or X-API-Key hash lookup) ---
def verify_supabase_jwt(authorization: Optional[str] = Header(None)) -> Optional[str]:
    supabase_url = os.environ.get("SUPABASE_URL")
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    jwt = authorization.split(" ", 1)[1]
    try:
        # Best-effort validation by asking Supabase to parse it
        r = requests.get(f"{supabase_url}/auth/v1/user", headers={"Authorization": f"Bearer {jwt}"}, timeout=5)
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

# --- Usage logging (optional; needs service role) ---
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
            },
            timeout=4,
        )
    except Exception:
        pass

# --- FastAPI app ---
api = FastAPI(title="ML Service on Modal", version="0.1.0")

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
    load_model_once()
    t0 = time.time()
    yhat = model.predict(payload.inputs).tolist()
    latency = int((time.time() - t0) * 1000)
    log_usage(user_id, "/predict", {"n": len(payload.inputs)}, {"n": len(yhat)}, latency)
    return {"outputs": yhat}

# --- Expose FastAPI via Modal ---
@app.asgi_app(image=image)
def fastapi_app():
    return api
