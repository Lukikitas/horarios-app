from playwright.sync_api import sync_playwright
import time

def verify_frontend():
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

            # 1. Verify Employee Priority Field
            print("Navigating to Employees view...")
            page.click("#btn-view-employees")
            time.sleep(1) # Allow transition

            # Check if priority column header exists
            header = page.locator("table.emp-table-new th:has-text('Prioridad')")
            if header.count() > 0:
                print("Priority column found.")
            else:
                print("Priority column NOT found.")

            # Click edit on the first employee to see the dropdown
            print("Clicking Edit on first employee...")
            edit_btn = page.locator("#empList table tbody tr:first-child button:has-text('Editar')")
            if edit_btn.count() > 0:
                edit_btn.click()
                time.sleep(0.5)
                # Check for priority select
                priority_select = page.locator("select[id^='edit-priority-input-']")
                if priority_select.count() > 0:
                    print("Priority dropdown found in edit mode.")
                else:
                    print("Priority dropdown NOT found.")

                page.screenshot(path="verification/employee_priority.png")
                print("Screenshot 'employee_priority.png' taken.")
            else:
                print("No employees found to edit.")

            # 2. Verify Auto-Assign Button in Actions Dropdown
            print("Navigating back to Schedule view...")
            page.click("#btn-view-schedule")
            time.sleep(1)

            print("Opening Actions dropdown...")
            page.click("#btn-actions")
            time.sleep(0.5)

            auto_assign_btn = page.locator("#btn-auto-assign")
            if auto_assign_btn.is_visible():
                print("Auto-assign button is visible.")
            else:
                print("Auto-assign button is NOT visible.")

            page.screenshot(path="verification/auto_assign_button.png")
            print("Screenshot 'auto_assign_button.png' taken.")

        except Exception as e:
            print(f"An error occurred: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_frontend()
