from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/wc2026"
    database_ssl: bool = False
    database_echo: bool = False
    secret_key: str = "change-me"
    admin_email: str = "admin"
    admin_password: str = "Admin"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
