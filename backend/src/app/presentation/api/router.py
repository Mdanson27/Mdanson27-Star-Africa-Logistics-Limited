from litestar import Router

from app.presentation.api.v1.admin_ops_controller import AdminOpsController
from app.presentation.api.v1.auth_controller import AuthController
from app.presentation.api.v1.bids_controller import BidsController
from app.presentation.api.v1.business_controller import BusinessController
from app.presentation.api.v1.commercial_documents_controller import CommercialDocumentsController
from app.presentation.api.v1.inventory_controller import InventoryController
from app.presentation.api.v1.reporting_controller import ReportingController
from app.presentation.api.v1.telemetry_controller import TelemetryController
from app.presentation.api.v1.users_controller import UsersController
from app.presentation.api.v1.workspace_controller import (
    DocumentsController,
    ProjectsController,
    TasksController,
    WorkspaceController,
)

api_router = Router(
    path="/api/v1",
    route_handlers=[
        AuthController,
        UsersController,
        TelemetryController,
        AdminOpsController,
        ProjectsController,
        TasksController,
        DocumentsController,
        WorkspaceController,
        BusinessController,
        BidsController,
        InventoryController,
        CommercialDocumentsController,
        ReportingController,
    ],
)
