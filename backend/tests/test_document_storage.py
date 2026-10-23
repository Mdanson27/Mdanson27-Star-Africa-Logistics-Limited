from app.core.settings import settings
from app.core.storage import (
    decode_local_key,
    delete_object,
    encode_local_key,
    get_object_bytes,
    local_storage_ready,
    object_exists,
    put_object_bytes,
    storage_provider,
)


def test_persistent_local_document_storage_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DOCUMENTS_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "AWS_ACCESS_KEY_ID", "")
    monkeypatch.setattr(settings, "AWS_SECRET_ACCESS_KEY", "")

    key = "documents/local/general/test-user/example.pdf"
    encoded = encode_local_key(key)

    assert decode_local_key(encoded) == key
    assert local_storage_ready() is True
    assert storage_provider() == "Persistent local storage"

    put_object_bytes(key, b"star-africa-document", "application/pdf")
    assert object_exists(key) is True
    assert get_object_bytes(key) == b"star-africa-document"

    delete_object(key)
    assert object_exists(key) is False
