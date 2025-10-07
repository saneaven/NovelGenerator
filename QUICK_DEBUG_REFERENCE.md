# Bcrypt Debug - Quick Reference Card

## Quick Test Commands

### 1. Test Bcrypt Directly (First Step)
```bash
curl -X POST http://localhost:8000/api/v1/auth/debug/test-hash
```
**What it does:** Tests if bcrypt works with hardcoded passwords
**Expected:** All tests return `"status": "SUCCESS"`

### 2. Test Registration with Debug Output
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testuser","password":"qwer1234"}'
```
**What it does:** Attempts registration with full debug logging
**Check:** Server console for detailed debug output

### 3. Run Local Test Script
```bash
cd App/backend
python test_bcrypt_debug.py
```
**What it does:** Tests imports and basic bcrypt functionality
**Expected:** All tests should pass

---

## What to Look For in Logs

### Good Pattern (Password is correct)
```
PYDANTIC: Password repr: 'qwer1234'          ✓
PYDANTIC: Password bytes: 8                   ✓
REGISTRATION: Password repr: 'qwer1234'      ✓
HASHING: Password repr: 'qwer1234'           ✓
HASHING: Password bytes: 8                    ✓
```

### Bad Pattern #1 (JSON Encoding)
```
PYDANTIC: Password repr: '"qwer1234"'        ✗ (has quotes!)
PYDANTIC: Password bytes: 10                  ✗ (should be 8)
```
**Fix:** Password is JSON-encoded. Check frontend.

### Bad Pattern #2 (Byte Explosion)
```
PYDANTIC: Password bytes: 150                ✗ (way too big!)
```
**Fix:** Encoding corruption. Check request Content-Type.

### Bad Pattern #3 (Unexpected Hex)
```
HASHING: Password hex: 227177657231323334   ✗ (starts with 22 = '"')
```
**Fix:** Confirms JSON encoding (0x22 is quote character).

---

## Log Section Order

Logs appear in this sequence:

1. **PYDANTIC PASSWORD VALIDATION** (earliest)
   - Shows raw value from request
   - First place to catch corruption

2. **REGISTRATION REQUEST DEBUG** (middle)
   - Shows value after Pydantic processing
   - Confirms what endpoint receives

3. **PASSWORD HASHING DEBUG** (latest)
   - Shows value before bcrypt
   - Last chance to catch issues

---

## Quick Fixes

### If Password Has Quotes ('"qwer1234"')

Add to `App/backend/schemas/auth.py` in the validator:

```python
if v.startswith('"') and v.endswith('"'):
    v = v[1:-1]  # Strip quotes
    v = v.replace('\\"', '"')  # Unescape
```

### If Bcrypt Installation Issue

```bash
pip uninstall passlib bcrypt
pip install passlib[bcrypt]
```

### If Still Failing

Check browser DevTools → Network → Request Payload
- Should be: `{"password": "qwer1234"}`
- NOT: `{"password": "\"qwer1234\""}`

---

## File Locations

- **Debug Guide:** `App/backend/BCRYPT_DEBUG_GUIDE.md`
- **Investigation Summary:** `BCRYPT_INVESTIGATION_SUMMARY.md`
- **Test Script:** `App/backend/test_bcrypt_debug.py`
- **Modified Files:**
  - `App/backend/auth.py`
  - `App/backend/routes/auth_routes.py`
  - `App/backend/schemas/auth.py`

---

## Debug Endpoints

- `POST /api/v1/auth/debug/test-hash` - Test bcrypt directly
- `POST /api/v1/auth/register` - Registration with debug logging

⚠️ Remove debug endpoint before production!

---

## Most Likely Issues (In Order)

1. **70% - Double JSON Encoding**
   - Password JSON-encoded before being sent
   - Check: Browser DevTools Network tab

2. **20% - String Conversion**
   - Password converted with str() or repr()
   - Check: Debug logs for quotes

3. **8% - Encoding Issue**
   - Unicode/charset corruption
   - Check: Hex encoding in logs

4. **2% - Bcrypt Installation**
   - Passlib/bcrypt broken
   - Check: Test endpoint results

---

## Success Criteria

✓ Test endpoint returns all SUCCESS
✓ Logs show 'qwer1234' (no quotes)
✓ Byte length is 8 throughout
✓ Registration completes without error
✓ User created in database

---

For full details, see `BCRYPT_INVESTIGATION_SUMMARY.md`
