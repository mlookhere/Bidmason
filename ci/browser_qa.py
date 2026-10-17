"""Run a real Chromium preview E2E against the built Next server.

No customer requests or provider credentials are used. Fail closed on layout,
keyboard, misleading intake, unsafe routes, or browser console errors.
"""
from __future__ import annotations

import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def available_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def status(url: str) -> int:
    try:
        with urlopen(url, timeout=2) as response:
            return response.status
    except HTTPError as error:
        return error.code


def await_server(url: str, server: subprocess.Popen[bytes]) -> None:
    for _ in range(100):
        if server.poll() is not None:
            raise RuntimeError(f"Next exited early with status {server.returncode}")
        try:
            if status(url) == 200:
                return
        except (OSError, URLError):
            pass
        time.sleep(0.25)
    raise TimeoutError("Built Next server did not respond within 25s")


def check_preview(browser, url: str, width: int, height: int, artifacts: Path) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    page = context.new_page()
    errors: list[str] = []
    outbound: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("console", lambda item: errors.append(item.text) if item.type == "error" else None)
    page.on("request", lambda req: outbound.append(f"{req.method} {req.url}") if req.method != "GET" else None)
    response = page.goto(url, wait_until="networkidle", timeout=30000)
    assert response is not None and response.status == 200, "Missing successful homepage HTTP response"
    assert page.get_by_role("banner").count() == 1, "Missing semantic header"
    assert page.get_by_role("main").count() == 1, "Missing semantic main"
    assert page.get_by_role("contentinfo").count() == 1, "Missing semantic footer"
    assert page.get_by_role("heading", level=1).count() == 1, "Missing unique H1"
    assert page.get_by_role("navigation", name="Main navigation").count() == 1
    assert page.locator("meta[name=robots]").get_attribute("content") is not None
    assert "noindex" in page.locator("meta[name=robots]").get_attribute("content")
    assert page.get_by_role("status").inner_text().startswith("Internal development preview")
    assert page.locator("form, input, textarea, select").count() == 0, "Preview exposes fake intake"
    assert page.get_by_text("not accepting submissions.", exact=False).count() >= 1
    assert not errors, f"Browser JavaScript errors: {errors}"
    assert not outbound, f"Unexpected outbound HTTP mutations: {outbound}"

    dimensions = page.evaluate("""() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      viewport: window.innerWidth
    })""")
    assert dimensions["html"] <= dimensions["viewport"] + 1, f"{width}px horizontal overflow: {dimensions}"
    assert dimensions["body"] <= dimensions["viewport"] + 1, f"{width}px body overflow: {dimensions}"
    assert page.evaluate("getComputedStyle(document.documentElement).scrollBehavior") == "auto", "Reduced-motion preference ignored"

    page.keyboard.press("Tab")
    active = page.evaluate("document.activeElement?.textContent?.trim()")
    assert active == "Skip to main content", f"Keyboard skip link is not first: {active!r}"
    assert page.evaluate("getComputedStyle(document.activeElement).outlineStyle") != "none"
    page.keyboard.press("Enter")
    assert page.evaluate("location.hash") == "#main-content", "Skip-link navigation did not reach main"

    nav = page.get_by_role("navigation", name="Main navigation")
    for name, fragment in [("Approach", "#approach"), ("What we're building", "#capabilities")]:
        link = nav.get_by_role("link", name=name)
        bounds = link.bounding_box()
        assert bounds is not None and bounds["height"] >= 44, f"Small touch target: {name}: {bounds}"
        link.click()
        assert page.evaluate("location.hash") == fragment, f"Broken {name} anchor"

    cta = page.get_by_role("link", name="Explore the concept")
    cta.click()
    assert page.evaluate("location.hash") == "#capabilities"
    assert not errors, f"Browser errors after navigation: {errors}"
    assert not outbound, f"Unexpected form/API call on navigation: {outbound}"

    screenshot = artifacts / f"bidmason-{width}.png"
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"PASS: Chromium viewport {width}x{height}; no overflow, landmarks, keyboard, focus, anchors, no intake; screenshot {screenshot}", flush=True)
    context.close()


def main() -> int:
    port = available_port()
    url = f"http://127.0.0.1:{port}"
    node = "node.exe" if os.name == "nt" else "node"
    command = [node, str(ROOT / "node_modules/next/dist/bin/next"), "start", "-p", str(port)]
    with tempfile.TemporaryDirectory(prefix="bidmason-e2e-") as folder:
        log = Path(folder) / "next.log"
        with log.open("wb") as stream:
            server = subprocess.Popen(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
            try:
                await_server(url, server)
                for path in ("/bidmason-website.html", "/historical-source/legacy-assets.lzma.b64", "/api/leads"):
                    assert status(url + path) == 404, f"Unexpected exposed demo/intake route: {path}"
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True)
                    try:
                        for width, height in ((320, 780), (375, 812), (768, 900), (1280, 800)):
                            check_preview(browser, url, width, height, Path(folder))
                    finally:
                        browser.close()
                print("PASS: no historical public routes or misleading lead endpoint", flush=True)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: real-browser accessibility/preview QA: {error}", file=sys.stderr)
        raise
