import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.main import app
from app.store import Base, db
from app import limits

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


@pytest.fixture(autouse=True)
def fresh_limits():
    limits.reset_all()
    yield
    limits.reset_all()


@pytest.fixture(autouse=True)
def no_enrichment(monkeypatch, request):
    """Extra model calls (formatted guide, infographics) are tested separately in test_enrich.py."""
    if request.node.get_closest_marker('real_enrich'):
        yield
        return
    from app import main
    async def none(source, summary, lang, **kwargs):
        return {'formatted': None, 'infographics': []}
    monkeypatch.setattr(main, 'enrich', none)
    yield


@pytest.fixture(autouse=True)
def media_folder(monkeypatch, tmp_path):
    """Pictures of uploaded guides go to a temporary folder, never to var/media."""
    from app import media
    monkeypatch.setattr(media, 'MEDIA_DIR', tmp_path / 'media')
    yield tmp_path / 'media'


def pytest_configure(config):
    config.addinivalue_line('markers', 'real_enrich: run the real formatting and infographics step')
