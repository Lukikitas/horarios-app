from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto('http://localhost:8000/manager.html')

            # Wait for loading overlay to disappear
            expect(page.locator('#loading-overlay')).to_have_class('hidden', timeout=10000)

            # Wait for main schedule content to appear
            expect(page.locator('#view-schedule')).to_be_visible()

            # Take screenshot of the main view
            page.screenshot(path='verification_refactor.png', full_page=True)
            print("Screenshot taken: verification_refactor.png")

            # Navigate to Employees
            page.click('#btn-view-employees')
            page.wait_for_timeout(500)
            page.screenshot(path='verification_employees.png')
            print("Screenshot taken: verification_employees.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path='verification_error.png')
        finally:
            browser.close()

if __name__ == "__main__":
    run()
