from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:8000")
    page.screenshot(path="verification/login.png")
    page.click("#show-dni-login")
    page.screenshot(path="verification/dni-login.png")
    page.goto("http://localhost:8000/portal")
    page.screenshot(path="verification/portal.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
