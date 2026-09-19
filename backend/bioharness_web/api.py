from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from .stream import event_stream


def create_router(service, *, poll_interval_seconds: float) -> APIRouter:
    router = APIRouter()

    @router.get("/api/health")
    def health():
        return {
            "status": "ok",
            "service": "BioHarness Observatory",
        }

    @router.get("/api/tasks")
    def list_tasks():
        return service.list_tasks()

    @router.get("/api/tasks/{task_id}")
    def get_task(task_id: UUID):
        value = service.get_task_summary(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/graph")
    def get_graph(task_id: UUID):
        value = service.get_task_graph(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/nodes/{node_id:path}")
    def get_node(task_id: UUID, node_id: str):
        try:
            value = service.get_node_detail(task_id, node_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="node not found")
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/events")
    def get_events(task_id: UUID):
        value = service.get_events(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/evidence/{evidence_id}")
    def get_evidence_preview(task_id: UUID, evidence_id: str):
        try:
            value = service.get_evidence_preview(task_id, evidence_id)
        except (KeyError, FileNotFoundError):
            raise HTTPException(status_code=404, detail="evidence not found")
        except ValueError:
            raise HTTPException(status_code=415, detail="evidence preview unsupported")
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/artifacts")
    def get_artifacts(task_id: UUID):
        value = service.get_artifacts(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/validation")
    def get_validation(task_id: UUID):
        value = service.get_validation(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/tasks/{task_id}/memory")
    def get_memory(task_id: UUID):
        value = service.get_memory(task_id)
        if value is None:
            raise HTTPException(status_code=404, detail="task not found")
        return value

    @router.get("/api/stream")
    async def stream():
        return StreamingResponse(
            event_stream(service, poll_interval_seconds),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    return router
