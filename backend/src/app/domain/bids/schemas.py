from __future__ import annotations

import uuid
from datetime import date, datetime

import msgspec


class BidCreate(msgspec.Struct, frozen=True):
    tender_number: str
    title: str
    procuring_entity: str
    client_id: uuid.UUID | None = None
    source: str | None = None
    category: str | None = None
    description: str | None = None
    status: str = "opportunity"
    publication_date: date | None = None
    closing_date: datetime | None = None
    submission_method: str | None = None
    submission_location: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    bid_fee_ugx: float = 0
    bid_security_ugx: float = 0
    estimated_value_ugx: float = 0
    internal_estimated_cost_ugx: float = 0
    proposed_bid_price_ugx: float = 0
    expected_profit_ugx: float = 0
    currency: str = "UGX"
    bid_manager_email: str | None = None
    team_emails: list[str] = msgspec.field(default_factory=list)
    eligibility_notes: str | None = None


class BidUpdate(msgspec.Struct, frozen=True):
    tender_number: str | None = None
    title: str | None = None
    procuring_entity: str | None = None
    client_id: uuid.UUID | None = None
    source: str | None = None
    category: str | None = None
    description: str | None = None
    status: str | None = None
    publication_date: date | None = None
    closing_date: datetime | None = None
    submission_method: str | None = None
    submission_location: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    bid_fee_ugx: float | None = None
    bid_security_ugx: float | None = None
    estimated_value_ugx: float | None = None
    internal_estimated_cost_ugx: float | None = None
    proposed_bid_price_ugx: float | None = None
    expected_profit_ugx: float | None = None
    currency: str | None = None
    bid_manager_email: str | None = None
    team_emails: list[str] | None = None
    eligibility_notes: str | None = None
    result_notes: str | None = None
    award_date: date | None = None
    award_value_ugx: float | None = None
    is_archived: bool | None = None


class BidRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    tender_number: str
    title: str
    procuring_entity: str
    client_id: uuid.UUID | None
    source: str | None
    category: str | None
    description: str | None
    status: str
    publication_date: date | None
    closing_date: datetime | None
    submission_method: str | None
    submission_location: str | None
    contact_person: str | None
    contact_email: str | None
    contact_phone: str | None
    bid_fee_ugx: float
    bid_security_ugx: float
    estimated_value_ugx: float
    internal_estimated_cost_ugx: float
    proposed_bid_price_ugx: float
    expected_profit_ugx: float
    currency: str
    bid_manager_email: str | None
    team_emails: list[str]
    eligibility_notes: str | None
    result_notes: str | None
    award_date: date | None
    award_value_ugx: float
    project_id: uuid.UUID | None
    converted_at: datetime | None
    created_by_email: str
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class BidRequirementCreate(msgspec.Struct, frozen=True):
    title: str
    description: str | None = None
    is_mandatory: bool = True
    status: str = "not_started"
    responsible_email: str | None = None
    due_date: date | None = None
    notes: str | None = None


class BidRequirementUpdate(msgspec.Struct, frozen=True):
    title: str | None = None
    description: str | None = None
    is_mandatory: bool | None = None
    status: str | None = None
    responsible_email: str | None = None
    due_date: date | None = None
    notes: str | None = None


class BidRequirementRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    bid_id: uuid.UUID
    title: str
    description: str | None
    is_mandatory: bool
    status: str
    responsible_email: str | None
    due_date: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class BidDashboardSummary(msgspec.Struct, frozen=True):
    total_bids: int
    open_opportunities: int
    preparing: int
    submitted: int
    evaluation: int
    awarded: int
    lost: int
    due_within_7_days: int
    overdue_open: int
    pipeline_value_ugx: float
    awarded_value_ugx: float
    win_rate_percent: float


class BidActivityRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    operation: str
    title: str
    summary: str
    changed_by: str | None
    created_at: datetime


class BidDocumentRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    title: str
    original_filename: str
    category: str
    content_type: str
    size_bytes: int
    uploaded_by_email: str
    created_at: datetime


class BidWorkspaceRead(msgspec.Struct, frozen=True):
    bid: BidRead
    requirements: list[BidRequirementRead]
    documents: list[BidDocumentRead]
    activity: list[BidActivityRead]


class BidConvertRequest(msgspec.Struct, frozen=True):
    project_name: str | None = None
    start_date: date | None = None
    due_date: date | None = None
