from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, ClassVar

from litestar import Controller, Request, delete, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from litestar.status_codes import HTTP_200_OK, HTTP_201_CREATED
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.audit.models import AuditLog
from app.domain.bids.models import Bid, BidRequirement
from app.domain.bids.schemas import (
    BidActivityRead,
    BidConvertRequest,
    BidCreate,
    BidDashboardSummary,
    BidDocumentRead,
    BidRead,
    BidRequirementCreate,
    BidRequirementRead,
    BidRequirementUpdate,
    BidUpdate,
    BidWorkspaceRead,
)
from app.domain.workspace.models import Document, Project
from app.domain.workspace.schemas import ProjectRead
from app.presentation.guards.auth_guard import JWTAuthGuard

STATUSES = {"opportunity", "preparing", "submitted", "evaluation", "awarded", "lost", "cancelled"}
REQ_STATUSES = {"not_started", "in_progress", "complete", "not_applicable"}


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _emails(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        cleaned = value.strip().lower()
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def _status(value: str) -> str:
    cleaned = value.strip().lower()
    if cleaned not in STATUSES:
        raise ClientException(detail="Invalid bid status.", status_code=400)
    return cleaned


def _req_status(value: str) -> str:
    cleaned = value.strip().lower()
    if cleaned not in REQ_STATUSES:
        raise ClientException(detail="Invalid requirement status.", status_code=400)
    return cleaned


def _read(item: Bid) -> BidRead:
    return BidRead(
        id=item.id,
        tender_number=item.tender_number,
        title=item.title,
        procuring_entity=item.procuring_entity,
        client_id=item.client_id,
        source=item.source,
        category=item.category,
        description=item.description,
        status=item.status,
        publication_date=item.publication_date,
        closing_date=item.closing_date,
        submission_method=item.submission_method,
        submission_location=item.submission_location,
        contact_person=item.contact_person,
        contact_email=item.contact_email,
        contact_phone=item.contact_phone,
        bid_fee_ugx=float(item.bid_fee_ugx or 0),
        bid_security_ugx=float(item.bid_security_ugx or 0),
        estimated_value_ugx=float(item.estimated_value_ugx or 0),
        internal_estimated_cost_ugx=float(item.internal_estimated_cost_ugx or 0),
        proposed_bid_price_ugx=float(item.proposed_bid_price_ugx or 0),
        expected_profit_ugx=float(item.expected_profit_ugx or 0),
        currency=item.currency,
        bid_manager_email=item.bid_manager_email,
        team_emails=list(item.team_emails or []),
        eligibility_notes=item.eligibility_notes,
        result_notes=item.result_notes,
        award_date=item.award_date,
        award_value_ugx=float(item.award_value_ugx or 0),
        project_id=item.project_id,
        converted_at=item.converted_at,
        created_by_email=item.created_by_email,
        is_archived=item.is_archived,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _req_read(item: BidRequirement) -> BidRequirementRead:
    return BidRequirementRead(
        id=item.id,
        bid_id=item.bid_id,
        title=item.title,
        description=item.description,
        is_mandatory=item.is_mandatory,
        status=item.status,
        responsible_email=item.responsible_email,
        due_date=item.due_date,
        notes=item.notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _project_read(item: Project) -> ProjectRead:
    return ProjectRead(
        id=item.id,
        name=item.name,
        client_name=item.client_name,
        client_id=item.client_id,
        description=item.description,
        status=item.status,
        value_ugx=float(item.value_ugx or 0),
        amount_paid_ugx=float(item.amount_paid_ugx or 0),
        start_date=item.start_date,
        due_date=item.due_date,
        progress=item.progress,
        project_manager_email=item.project_manager_email,
        team_emails=list(item.team_emails or []),
        tags=list(item.tags or []),
        current_milestone=item.current_milestone,
        created_by_email=item.created_by_email,
        is_archived=item.is_archived,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


class BidsController(Controller):
    path = "/bids"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get()
    async def list_bids(
        self,
        db_session: AsyncSession,
        q: str | None = None,
        status: str | None = None,
        include_archived: bool = False,
    ) -> list[BidRead]:
        stmt = select(Bid).order_by(Bid.closing_date.asc().nullslast(), Bid.updated_at.desc())
        if not include_archived:
            stmt = stmt.where(Bid.is_archived.is_(False))
        if status:
            stmt = stmt.where(Bid.status == _status(status))
        if q:
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Bid.title.ilike(term),
                    Bid.tender_number.ilike(term),
                    Bid.procuring_entity.ilike(term),
                    Bid.category.ilike(term),
                    Bid.source.ilike(term),
                )
            )
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_read(row) for row in rows]

    @get(path="/dashboard")
    async def dashboard(self, db_session: AsyncSession) -> BidDashboardSummary:
        now = datetime.now(UTC)
        seven = now + timedelta(days=7)
        current = Bid.is_archived.is_(False)
        open_statuses = ["opportunity", "preparing", "submitted", "evaluation"]

        async def count(*conds: Any) -> int:
            return int(
                (
                    await db_session.scalar(
                        select(func.count()).select_from(Bid).where(current, *conds)
                    )
                )
                or 0
            )

        total = await count()
        awarded = await count(Bid.status == "awarded")
        lost = await count(Bid.status == "lost")
        decided = awarded + lost
        pipeline = await db_session.scalar(
            select(func.coalesce(func.sum(Bid.estimated_value_ugx), 0)).where(
                current, Bid.status.in_(open_statuses)
            )
        )
        awarded_value = await db_session.scalar(
            select(
                func.coalesce(
                    func.sum(func.greatest(Bid.award_value_ugx, Bid.estimated_value_ugx)), 0
                )
            ).where(current, Bid.status == "awarded")
        )
        return BidDashboardSummary(
            total_bids=total,
            open_opportunities=await count(Bid.status == "opportunity"),
            preparing=await count(Bid.status == "preparing"),
            submitted=await count(Bid.status == "submitted"),
            evaluation=await count(Bid.status == "evaluation"),
            awarded=awarded,
            lost=lost,
            due_within_7_days=await count(
                Bid.status.in_(open_statuses),
                Bid.closing_date.is_not(None),
                Bid.closing_date >= now,
                Bid.closing_date <= seven,
            ),
            overdue_open=await count(
                Bid.status.in_(open_statuses), Bid.closing_date.is_not(None), Bid.closing_date < now
            ),
            pipeline_value_ugx=float(pipeline or 0),
            awarded_value_ugx=float(awarded_value or 0),
            win_rate_percent=round((awarded / decided * 100), 1) if decided else 0,
        )

    @post(status_code=HTTP_201_CREATED)
    async def create_bid(
        self, request: Request, data: BidCreate, db_session: AsyncSession
    ) -> BidRead:
        tender_number = data.tender_number.strip()
        title = data.title.strip()
        entity = data.procuring_entity.strip()
        if not tender_number or not title or not entity:
            raise ClientException(
                detail="Tender number, title and procuring entity are required.", status_code=400
            )
        item = Bid(
            tender_number=tender_number,
            title=title,
            procuring_entity=entity,
            client_id=data.client_id,
            source=(data.source or "").strip() or None,
            category=(data.category or "").strip() or None,
            description=(data.description or "").strip() or None,
            status=_status(data.status),
            publication_date=data.publication_date,
            closing_date=data.closing_date,
            submission_method=(data.submission_method or "").strip() or None,
            submission_location=(data.submission_location or "").strip() or None,
            contact_person=(data.contact_person or "").strip() or None,
            contact_email=(data.contact_email or "").strip().lower() or None,
            contact_phone=(data.contact_phone or "").strip() or None,
            bid_fee_ugx=Decimal(str(max(0, data.bid_fee_ugx))),
            bid_security_ugx=Decimal(str(max(0, data.bid_security_ugx))),
            estimated_value_ugx=Decimal(str(max(0, data.estimated_value_ugx))),
            internal_estimated_cost_ugx=Decimal(str(max(0, data.internal_estimated_cost_ugx))),
            proposed_bid_price_ugx=Decimal(str(max(0, data.proposed_bid_price_ugx))),
            expected_profit_ugx=Decimal(str(max(0, data.expected_profit_ugx))),
            currency=data.currency.strip().upper() or "UGX",
            bid_manager_email=(data.bid_manager_email or _email(request)).strip().lower() or None,
            team_emails=_emails(data.team_emails),
            eligibility_notes=(data.eligibility_notes or "").strip() or None,
            created_by_email=_email(request),
        )
        db_session.add(item)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(
                detail="A bid with this tender number already exists.", status_code=409
            ) from exc
        await db_session.refresh(item)
        return _read(item)

    @get(path="/{bid_id:uuid}")
    async def get_bid(self, bid_id: uuid.UUID, db_session: AsyncSession) -> BidRead:
        item = await db_session.get(Bid, bid_id)
        if item is None:
            raise NotFoundException(detail="Bid not found.")
        return _read(item)

    @patch(path="/{bid_id:uuid}")
    async def update_bid(
        self, bid_id: uuid.UUID, data: BidUpdate, db_session: AsyncSession
    ) -> BidRead:
        item = await db_session.get(Bid, bid_id)
        if item is None:
            raise NotFoundException(detail="Bid not found.")
        if data.status is not None:
            item.status = _status(data.status)
        for field in (
            "tender_number",
            "title",
            "procuring_entity",
            "source",
            "category",
            "description",
            "publication_date",
            "closing_date",
            "submission_method",
            "submission_location",
            "contact_person",
            "contact_email",
            "contact_phone",
            "eligibility_notes",
            "result_notes",
            "award_date",
            "is_archived",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value.strip() if isinstance(value, str) else value)
        if data.client_id is not None:
            item.client_id = data.client_id
        if data.bid_manager_email is not None:
            item.bid_manager_email = data.bid_manager_email.strip().lower() or None
        if data.team_emails is not None:
            item.team_emails = _emails(data.team_emails)
        if data.currency is not None:
            item.currency = data.currency.strip().upper() or "UGX"
        for field in (
            "bid_fee_ugx",
            "bid_security_ugx",
            "estimated_value_ugx",
            "internal_estimated_cost_ugx",
            "proposed_bid_price_ugx",
            "expected_profit_ugx",
            "award_value_ugx",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, Decimal(str(max(0, value))))
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(detail="Tender number must be unique.", status_code=409) from exc
        await db_session.refresh(item)
        return _read(item)

    @get(path="/{bid_id:uuid}/workspace")
    async def workspace(self, bid_id: uuid.UUID, db_session: AsyncSession) -> BidWorkspaceRead:
        bid = await db_session.get(Bid, bid_id)
        if bid is None:
            raise NotFoundException(detail="Bid not found.")
        reqs = (
            (
                await db_session.execute(
                    select(BidRequirement)
                    .where(BidRequirement.bid_id == bid_id)
                    .order_by(BidRequirement.is_mandatory.desc(), BidRequirement.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        docs = (
            (
                await db_session.execute(
                    select(Document)
                    .where(
                        Document.related_record_type == "bid",
                        Document.related_record_id == bid_id,
                        Document.is_deleted.is_(False),
                    )
                    .order_by(Document.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        key = str(bid_id)
        activity = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        or_(
                            and_(AuditLog.table_name == "bids", AuditLog.record_id == bid_id),
                            and_(
                                AuditLog.table_name == "bid_requirements",
                                or_(
                                    AuditLog.new_data["bid_id"].astext == key,
                                    AuditLog.old_data["bid_id"].astext == key,
                                ),
                            ),
                            and_(
                                AuditLog.table_name == "documents",
                                or_(
                                    AuditLog.new_data["related_record_id"].astext == key,
                                    AuditLog.old_data["related_record_id"].astext == key,
                                ),
                            ),
                        )
                    )
                    .order_by(AuditLog.created_at.desc())
                    .limit(80)
                )
            )
            .scalars()
            .all()
        )
        return BidWorkspaceRead(
            bid=_read(bid),
            requirements=[_req_read(r) for r in reqs],
            documents=[
                BidDocumentRead(
                    id=d.id,
                    title=d.title,
                    original_filename=d.original_filename,
                    category=d.category,
                    content_type=d.content_type,
                    size_bytes=d.size_bytes,
                    uploaded_by_email=d.uploaded_by_email,
                    created_at=d.created_at,
                )
                for d in docs
            ],
            activity=[
                BidActivityRead(
                    id=a.id,
                    operation=a.operation,
                    title=a.table_name.replace("_", " ").title(),
                    summary=f"{a.operation.title()} {a.table_name.replace('_', ' ')}",
                    changed_by=a.changed_by,
                    created_at=a.created_at,
                )
                for a in activity
            ],
        )

    @post(path="/{bid_id:uuid}/requirements", status_code=HTTP_201_CREATED)
    async def add_requirement(
        self, bid_id: uuid.UUID, data: BidRequirementCreate, db_session: AsyncSession
    ) -> BidRequirementRead:
        if await db_session.get(Bid, bid_id) is None:
            raise NotFoundException(detail="Bid not found.")
        if not data.title.strip():
            raise ClientException(detail="Requirement title is required.", status_code=400)
        item = BidRequirement(
            bid_id=bid_id,
            title=data.title.strip(),
            description=(data.description or "").strip() or None,
            is_mandatory=data.is_mandatory,
            status=_req_status(data.status),
            responsible_email=(data.responsible_email or "").strip().lower() or None,
            due_date=data.due_date,
            notes=(data.notes or "").strip() or None,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _req_read(item)

    @patch(path="/{bid_id:uuid}/requirements/{requirement_id:uuid}")
    async def update_requirement(
        self,
        bid_id: uuid.UUID,
        requirement_id: uuid.UUID,
        data: BidRequirementUpdate,
        db_session: AsyncSession,
    ) -> BidRequirementRead:
        item = await db_session.get(BidRequirement, requirement_id)
        if item is None or item.bid_id != bid_id:
            raise NotFoundException(detail="Requirement not found.")
        if data.status is not None:
            item.status = _req_status(data.status)
        for field in (
            "title",
            "description",
            "is_mandatory",
            "responsible_email",
            "due_date",
            "notes",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value.strip() if isinstance(value, str) else value)
        await db_session.commit()
        await db_session.refresh(item)
        return _req_read(item)

    @delete(path="/{bid_id:uuid}/requirements/{requirement_id:uuid}", status_code=HTTP_200_OK)
    async def delete_requirement(
        self, bid_id: uuid.UUID, requirement_id: uuid.UUID, db_session: AsyncSession
    ) -> dict:
        item = await db_session.get(BidRequirement, requirement_id)
        if item is None or item.bid_id != bid_id:
            raise NotFoundException(detail="Requirement not found.")
        await db_session.delete(item)
        await db_session.commit()
        return {"message": "Requirement deleted."}

    @post(path="/{bid_id:uuid}/convert-to-project", status_code=HTTP_201_CREATED)
    async def convert_to_project(
        self, request: Request, bid_id: uuid.UUID, data: BidConvertRequest, db_session: AsyncSession
    ) -> ProjectRead:
        bid = await db_session.get(Bid, bid_id)
        if bid is None:
            raise NotFoundException(detail="Bid not found.")
        if bid.status != "awarded":
            raise ClientException(
                detail="Only awarded bids can be converted to projects.", status_code=400
            )
        if bid.project_id is not None:
            existing = await db_session.get(Project, bid.project_id)
            if existing is not None:
                return _project_read(existing)
        incomplete = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(BidRequirement)
                    .where(
                        BidRequirement.bid_id == bid_id,
                        BidRequirement.is_mandatory.is_(True),
                        BidRequirement.status.notin_(["complete", "not_applicable"]),
                    )
                )
            )
            or 0
        )
        if incomplete:
            raise ClientException(
                detail=f"Complete the {incomplete} outstanding mandatory requirement(s) before project conversion.",
                status_code=409,
            )
        value = bid.award_value_ugx if (bid.award_value_ugx or 0) > 0 else bid.estimated_value_ugx
        project = Project(
            name=(data.project_name or bid.title).strip(),
            client_id=bid.client_id,
            client_name=bid.procuring_entity,
            description=bid.description,
            status="planning",
            value_ugx=value or Decimal(0),
            amount_paid_ugx=Decimal(0),
            start_date=data.start_date,
            due_date=data.due_date,
            progress=0,
            project_manager_email=bid.bid_manager_email or _email(request),
            team_emails=list(bid.team_emails or []),
            tags=["Tender", bid.tender_number],
            current_milestone="Contract mobilisation",
            created_by_email=_email(request),
            is_archived=False,
        )
        db_session.add(project)
        await db_session.flush()
        bid.project_id = project.id
        bid.converted_at = datetime.now(UTC)
        docs = (
            (
                await db_session.execute(
                    select(Document).where(
                        Document.related_record_type == "bid",
                        Document.related_record_id == bid_id,
                        Document.is_deleted.is_(False),
                    )
                )
            )
            .scalars()
            .all()
        )
        for doc in docs:
            if doc.project_id is None:
                doc.project_id = project.id
        await db_session.commit()
        await db_session.refresh(project)
        return _project_read(project)
