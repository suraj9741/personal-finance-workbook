"""Banks added from the account form, with their logos."""

import base64

from tests.conftest import Api

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def data_url(data: bytes, kind: str = "image/png") -> str:
    return f"data:{kind};base64,{base64.b64encode(data).decode()}"


def test_add_a_bank_with_its_logo(admin: Api, solo: Api) -> None:
    added = admin.post("/api/v1/institutions", json={"name": "Kotak", "logo": data_url(PNG)})
    assert added.status_code == 201, added.text
    # Site-wide: another household sees it and its logo.
    assert [i["name"] for i in solo.get("/api/v1/institutions").json()] == ["Kotak"]
    logo = solo.get(f"/api/v1/institutions/{added.json()['id']}/logo")
    assert logo.status_code == 200
    assert logo.headers["content-type"] == "image/png"
    assert logo.content == PNG


def test_same_name_twice_is_refused(admin: Api) -> None:
    body = {"name": "Kotak", "logo": data_url(PNG)}
    assert admin.post("/api/v1/institutions", json=body).status_code == 201
    again = admin.post("/api/v1/institutions", json={**body, "name": "kotak"})
    assert again.status_code == 409


def test_only_real_png_jpeg_or_webp_logos(admin: Api) -> None:
    svg = data_url(b"<svg onload='alert(1)'/>", "image/svg+xml")
    fake = data_url(b"not a png", "image/png")
    big = data_url(PNG + b"\x00" * 210 * 1024)
    for logo in (svg, fake, big, "https://example.com/logo.png"):
        body = {"name": "Axis", "logo": logo}
        assert admin.post("/api/v1/institutions", json=body).status_code == 422


def test_logged_out_sees_nothing(admin: Api) -> None:
    from tests.conftest import new_client

    assert new_client().get("/api/v1/institutions").status_code == 401
