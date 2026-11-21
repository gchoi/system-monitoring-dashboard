import asyncio
import os
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from gpu_monitor import GPUMonitor
from system_monitor import SystemMonitor

from pydantic import BaseModel
import psutil

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SystemMonitorAPI")

app = FastAPI(title="Realtime System Monitor API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for easy docker-compose deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Monitors (real telemetry only; unavailable metrics are reported as null)
gpu_monitor = GPUMonitor()
system_monitor = SystemMonitor()


class KillProcessRequest(BaseModel):
    force: bool = False


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "hostname": system_monitor.hostname,
        "platform": system_monitor.platform["os"],
        "platform_info": system_monitor.platform,
        **gpu_monitor.info(),
    }


@app.post("/api/processes/{pid}/kill")
def kill_process(pid: int, req: KillProcessRequest = KillProcessRequest()):
    from fastapi import HTTPException

    if pid <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot terminate system init / root process (PID <= 1)."
        )

    if pid == os.getpid():
        raise HTTPException(
            status_code=400,
            detail="Refusing to terminate the monitoring API server itself."
        )

    try:
        proc = psutil.Process(pid)
        proc_name = proc.name()
    except psutil.NoSuchProcess:
        raise HTTPException(
            status_code=404,
            detail=f"Process with PID {pid} was not found or already terminated."
        )
    except psutil.AccessDenied:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied to access process with PID {pid}."
        )

    try:
        if req.force:
            proc.kill()
            action_type = "SIGKILL"
        else:
            proc.terminate()
            action_type = "SIGTERM"

        logger.info(f"Sent {action_type} to process {proc_name} (PID: {pid})")
        return {
            "success": True,
            "message": f"Successfully sent {action_type} to process '{proc_name}' (PID: {pid}).",
            "pid": pid,
            "name": proc_name,
        }
    except psutil.NoSuchProcess:
        return {
            "success": True,
            "message": f"Process {pid} already terminated.",
            "pid": pid,
            "name": proc_name,
        }
    except psutil.AccessDenied:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: insufficient privileges to terminate process '{proc_name}' (PID: {pid})."
        )
    except Exception as e:
        logger.error(f"Error terminating process {pid}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to terminate process {pid}: {str(e)}"
        )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"Client connected from {websocket.client}")
    try:
        while True:
            # Gather GPU + System telemetry
            # psutil / ioreg calls are blocking -> run off the event loop
            gpu_data = await asyncio.to_thread(gpu_monitor.get_gpu_data)
            system_data = await asyncio.to_thread(system_monitor.get_full_system_data)

            # Combine into a single payload
            payload = {
                **gpu_data,
                "system": system_data,
            }

            # Send to client
            await websocket.send_text(json.dumps(payload))

            # Rate of update (1 second)
            await asyncio.sleep(1.0)

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {websocket.client}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
