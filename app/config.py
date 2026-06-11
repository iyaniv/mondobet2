from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/wc2026"
    database_ssl: bool = False
    database_echo: bool = False
    secret_key: str = "change-me"
    admin_email: str = "admin"
    admin_password: str = "Admin"

    # football-data.org API key. When set, the GET /live/ poll auto-syncs
    # World Cup scores from the external feed into the live_matches table.
    # Empty string = feature disabled (no external calls), so local/dev and
    # the demo build behave exactly as before.
    football_data_api_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
