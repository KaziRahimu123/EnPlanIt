"""SQLAlchemy ORM models for EnPlanIt Scenario Lab."""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, ForeignKey, DateTime, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    # Nullable — OAuth-only users have no password
    password_hash: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    missions: Mapped[list["Mission"]] = relationship(
        "Mission", back_populates="owner", cascade="all, delete-orphan"
    )
    oauth_accounts: Mapped[list["OAuthAccount"]] = relationship(
        "OAuthAccount", back_populates="user", cascade="all, delete-orphan"
    )


class OAuthAccount(Base):
    """Stores the link between an EnPlanIt user and a third-party OAuth identity."""

    __tablename__ = "oauth_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # e.g. "google" or "github"
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    # The subject ID returned by the provider (stable across logins)
    provider_user_id: Mapped[str] = mapped_column(String(256), nullable=False)
    # Display name from provider (updated on each login)
    provider_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Email returned by provider (for informational display only)
    provider_email: Mapped[Optional[str]] = mapped_column(String(254), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="oauth_accounts")


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # AI analysis results (stored as individual columns)
    destination: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    mission_type: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    objective: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    power_source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    known_resources: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # AI plan sections
    mission_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    objectives: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    required_resources: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    major_constraints: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    planning_considerations: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    missing_information: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    owner: Mapped["User"] = relationship("User", back_populates="missions")
    scenario: Mapped[Optional["ScenarioResult"]] = relationship(
        "ScenarioResult", back_populates="mission", cascade="all, delete-orphan", uselist=False
    )


class ScenarioResult(Base):
    __tablename__ = "scenario_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    mission_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # Variable snapshots (JSON strings)
    before_vars: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_vars: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Concern results (JSON strings)
    concerns_before: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    concerns_after: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Variable changes list (JSON string)
    changes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # AI insights (JSON string)
    insights: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    mission: Mapped["Mission"] = relationship("Mission", back_populates="scenario")
