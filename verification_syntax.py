
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        # Navigate to the manager page
        page.goto("http://localhost:8000/manager.html")

        # Check if the page title is correct or if a key element exists to confirm loading
        # Since it's a manager page, it might redirect if not auth, but let's see if it loads the script
        # We are checking for syntax errors in app.js basically.

        # Wait for a bit to let scripts execute
        page.wait_for_timeout(2000)

        # Take a screenshot
        page.screenshot(path="verification_manager.png")
        print("Screenshot taken")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
