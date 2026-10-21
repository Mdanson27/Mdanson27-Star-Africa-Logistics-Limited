from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    # ── Runtime ───────────────────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "override-in-environment"
    APP_NAME: str = "Star Africa Logistics Operating System"
    APP_BASE_URL: str = "http://localhost:8000"
    CORS_ALLOWED_ORIGINS: str = "https://mdanson27.github.io,http://localhost:5173"

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://app_user:change-me@localhost:5432/app_db"
    DATABASE_URL_UNPOOLED: str | None = None
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5

    # ── Neon Managed Better Auth ─────────────────────────────────────────────
    NEON_AUTH_BASE_URL: str = ""
    NEON_AUTH_JWKS_URL: str = ""
    PLATFORM_ADMIN_EMAIL: str = ""

    # ── Cache (Valkey) ────────────────────────────────────────────────────────
    VALKEY_URL: str | None = None
    VALKEY_HOST: str = "localhost"
    VALKEY_PORT: int = 6379

    # ── Neon Object Storage ─────────────────────────────────────────────────
    AWS_ENDPOINT_URL_S3: str = ""
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-2"
    DOCUMENTS_BUCKET: str = "star-africa-logistics-documents"

    # ── Token TTLs ────────────────────────────────────────────────────────────
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    RESET_TOKEN_EXPIRE_MINUTES: int = 60
    VERIFY_TOKEN_EXPIRE_MINUTES: int = 1440

    # ── SMTP / Mail ───────────────────────────────────────────────────────────
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_TLS: bool = True
    EMAILS_FROM_ADDRESS: str = "noreply@starafricalogistics.com"
    EMAILS_FROM_NAME: str = "Star Africa Logistics Operating System"

    # ── Initial Superuser Seeding ─────────────────────────────────────────────
    FIRST_SUPERUSER_EMAIL: str = ""
    FIRST_SUPERUSER_PASSWORD: str = ""
    FIRST_SUPERUSER_NAME: str = "Platform Administrator"

    # ── Rate Limiting & Gateway ───────────────────────────────────────────────
    RATE_LIMIT_ENABLED: bool = True

    # ── API Documentation UI ──────────────────────────────────────────────────
    DOCS_UI: str = "swagger"

    # ── Observability & Crash Reporting (Sentry) ──────────────────────────────
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.1

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def smtp_configured(self) -> bool:
        """True only when all required SMTP credentials are present."""
        return bool(self.SMTP_HOST and self.SMTP_USER and self.SMTP_PASSWORD)

    @property
    def database_url_async(self) -> str:
        """Normalize the preferred Postgres URL for SQLAlchemy/asyncpg.

        When Neon provides an unpooled endpoint, Star Africa Logistics uses it behind its own
        small SQLAlchemy pool instead of double-pooling through Neon's pooler.
        """
        url = (self.DATABASE_URL_UNPOOLED or self.DATABASE_URL).strip()
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]
        url = url.replace("sslmode=require", "ssl=require")
        url = url.replace("&channel_binding=require", "").replace("?channel_binding=require&", "?")
        return url

    @property
    def valkey_url(self) -> str:
        if self.VALKEY_URL:
            return self.VALKEY_URL
        return f"redis://{self.VALKEY_HOST}:{self.VALKEY_PORT}/0"

    @property
    def cors_origins(self) -> list[str]:
        return [item.strip() for item in self.CORS_ALLOWED_ORIGINS.split(",") if item.strip()]

    @property
    def admin_emails(self) -> set[str]:
        return {self.PLATFORM_ADMIN_EMAIL.strip().lower()}

    @property
    def platform_admin_email(self) -> str:
        return self.PLATFORM_ADMIN_EMAIL.strip().lower()


settings = AppSettings()
