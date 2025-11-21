from playwright.sync_api import sync_playwright
import time

def verify_updated_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the manager page
            page.goto("http://localhost:8000/manager.html")

            # Wait for data to load
            try:
                page.wait_for_selector("#dayTabs button", timeout=5000)
            except:
                print("Timeout waiting for day tabs, proceeding anyway...")

            # 1. Verify Priority Column is GONE from main view
            print("Navigating to Employees view...")
            page.click("#btn-view-employees")
            time.sleep(1)

            # Check if priority column header exists (Should NOT exist)
            header = page.locator("table.emp-table-new th:has-text('Prioridad')")
            if header.count() == 0:
                print("SUCCESS: Priority column is hidden in main view.")
            else:
                print("FAILURE: Priority column is visible.")

            # 2. Verify 5 Priority Levels in Edit Mode
            print("Clicking Edit on first employee...")
            edit_btn = page.locator("#empList table tbody tr:first-child button:has-text('Editar')")
            if edit_btn.count() > 0:
                edit_btn.click()
                time.sleep(0.5)
                # Check for priority select
                priority_select = page.locator("select[id^='edit-priority-input-']")
                if priority_select.count() > 0:
                    options = priority_select.locator("option")
                    count = options.count()
                    print(f"Priority dropdown found with {count} options.")

                    # Optional: Check specific values
                    texts = options.all_inner_texts()
                    if "Muy Alta" in texts and "Muy Baja" in texts:
                         print("SUCCESS: Priority dropdown has 5 levels (Muy Alta...Muy Baja).")
                    else:
                         print(f"FAILURE: Priority dropdown options are unexpected: {texts}")

                    page.screenshot(path="verification/updated_employee_edit.png")
                    print("Screenshot 'updated_employee_edit.png' taken.")
                else:
                    print("Priority dropdown NOT found.")
            else:
                print("No employees found to edit.")

        except Exception as e:
            print(f"An error occurred: {e}")
            page.screenshot(path="verification/error_updated.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_updated_frontend()
