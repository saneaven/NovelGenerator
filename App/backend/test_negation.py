"""Test script to verify template negation operator works correctly"""
from backend.services.template_validator import validator

# Test cases
test_cases = [
    {
        "name": "Negation with thinking",
        "template": "{{#if::!thinking}}No thinking mode{{/if}}",
        "should_pass": True
    },
    {
        "name": "Regular conditional",
        "template": "{{#if::thinking}}Thinking mode{{/if}}",
        "should_pass": True
    },
    {
        "name": "Negation with prefill",
        "template": "{{#if::!prefill}}No prefill{{/if}}",
        "should_pass": True
    },
    {
        "name": "Malformed negation (missing name)",
        "template": "{{#if::!}}Invalid{{/if}}",
        "should_pass": False
    },
    {
        "name": "Complex template with negation",
        "template": """
{{#if::thinking}}
Enable thinking mode
{{/if}}

{{#if::!thinking}}
Disable thinking mode
{{/if}}

Some content here

{{#if::prefill}}
Add prefill
{{/if}}
        """,
        "should_pass": True
    },
    {
        "name": "Unclosed negation block",
        "template": "{{#if::!thinking}}No closing tag",
        "should_pass": False
    }
]

print("Testing Template Negation Operator Support\n")
print("=" * 60)

passed = 0
failed = 0

for test_case in test_cases:
    result = validator.validate(test_case["template"])
    expected = test_case["should_pass"]
    actual = result.valid

    status = "[PASS]" if expected == actual else "[FAIL]"

    if expected == actual:
        passed += 1
    else:
        failed += 1

    print(f"\n{status} - {test_case['name']}")
    print(f"  Expected: {'Valid' if expected else 'Invalid'}")
    print(f"  Actual:   {'Valid' if actual else 'Invalid'}")

    if result.errors:
        print(f"  Errors: {len(result.errors)}")
        for error in result.errors:
            print(f"    - Line {error.line}: {error.message}")

    if result.warnings:
        print(f"  Warnings: {len(result.warnings)}")
        for warning in result.warnings:
            print(f"    - Line {warning.line}: {warning.message}")

print("\n" + "=" * 60)
print(f"\nResults: {passed} passed, {failed} failed out of {len(test_cases)} tests")

if failed == 0:
    print("[SUCCESS] All tests passed!")
else:
    print("[FAILED] Some tests failed")
