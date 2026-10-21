import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.main import app
from app.store import Base, db

@pytest.fixture
def database():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    def override():
        with factory() as session:
            yield session
    app.dependency_overrides[db] = override
    yield factory
    app.dependency_overrides.clear()
    engine.dispose()
