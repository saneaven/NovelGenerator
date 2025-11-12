# Migration Execution Guide

Quick reference for executing the multilingual system migration.

## Pre-Migration Checklist

- [ ] Database backup completed
- [ ] All users notified of maintenance window
- [ ] Application stopped
- [ ] Git commit of current state
- [ ] Read full documentation in `MULTILINGUAL_SYSTEM_REDESIGN.md`

## Migration Steps

### 1. Backup Database
```bash
pg_dump novelgenerator > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Stop Application
```bash
# Stop backend
pkill -f uvicorn

# Stop frontend (if running separately)
# pm2 stop frontend
```

### 3. Run Database Migrations
```bash
cd App/backend

# Create new tables
alembic upgrade head

# Expected output: "Running upgrade 005 -> 006, multilingual_redesign"
```

### 4. Migrate Data
```bash
# Run data migration script
python -m migrations.migrate_translation_data

# Watch for "✓ Migration completed successfully!"
# If errors occur, DO NOT PROCEED - investigate first
```

### 5. Validate Migration
```bash
# Run validation script
python -m migrations.validate_migration

# Must see "✓ All validation checks passed!"
# If ANY errors, DO NOT PROCEED
```

### 6. Remove Flat Fields (Point of No Return!)
```bash
# ONLY if validation passed 100%
alembic upgrade head

# Expected output: "Running upgrade 006 -> 007, remove_flat_fields"
```

### 7. Deploy Frontend
```bash
cd App/frontend

# Install dependencies (if any new ones)
npm install

# Build
npm run build

# Deploy built files to server
```

### 8. Restart Application
```bash
cd App/backend
uvicorn main:app --host 0.0.0.0 --port 8000

# Or use your production startup script
```

### 9. Smoke Test
```bash
# Test basic operations:

# 1. Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# 2. Get a character (replace IDs)
curl http://localhost:8000/objects/character/YOUR_CHARACTER_ID?language=English \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Switch language
curl -X PATCH http://localhost:8000/objects/character/YOUR_CHARACTER_ID/active-language \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"Korean"}'

# 4. Update character
curl -X PUT http://localhost:8000/objects/character/YOUR_CHARACTER_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {"name": "Test", "description": "Test"},
    "language": "English",
    "create_new_version": true
  }'
```

## Rollback (if needed before Step 6)

```bash
# Restore database
psql novelgenerator < backup_TIMESTAMP.sql

# Downgrade migrations
cd App/backend
alembic downgrade 005

# Restart application with old code
git checkout <previous-commit>
```

## Post-Migration Checklist

- [ ] All endpoints responding correctly
- [ ] Users can view objects in all languages
- [ ] Language switching works without creating versions
- [ ] Updates create new versions correctly
- [ ] Translation cache updating properly
- [ ] No errors in application logs
- [ ] Performance is acceptable
- [ ] Notify users application is back online

## Monitoring

After migration, monitor these metrics for first 24 hours:

1. **Response Times**:
   - GET /objects/* endpoints should be < 100ms
   - PUT /objects/* endpoints should be < 200ms

2. **Error Rates**:
   - Should be near zero for object operations

3. **Database Queries**:
   - Check slow query log for any issues

4. **User Feedback**:
   - Monitor for any translation-related issues

## Emergency Contacts

- Database Admin: [contact info]
- Backend Lead: [contact info]
- Frontend Lead: [contact info]

## Common Issues

### Issue: "Table object_versions already exists"
**Solution**: Migration already partially run. Check current state:
```bash
alembic current
```

### Issue: Data migration shows errors
**Solution**: DO NOT CONTINUE. Review errors, fix data, re-run:
```bash
python -m migrations.migrate_translation_data
```

### Issue: Validation fails
**Solution**: DO NOT REMOVE FLAT FIELDS. Investigate validation errors, fix, re-validate.

### Issue: Application won't start after migration
**Solution**: Check logs:
```bash
tail -f App/backend/logs/app.log
```

Common cause: Import errors from removed models. Update imports to use new translation_models.

## Success Criteria

Migration is successful when:

✅ All validation checks pass
✅ Application starts without errors
✅ Users can view/edit objects in all languages
✅ Language switching works correctly
✅ No data loss (verify key objects manually)
✅ Performance meets SLAs
✅ Error rate < 0.1%

## Timeline

Estimated duration: **2-4 hours**

- Backup: 10 minutes
- Migration: 30 minutes
- Validation: 10 minutes
- Deployment: 30 minutes
- Testing: 1-2 hours
- Buffer: 1 hour

Schedule during low-traffic hours (e.g., 2 AM - 6 AM).

## Helpful Commands

```bash
# Check database size
psql novelgenerator -c "SELECT pg_size_pretty(pg_database_size('novelgenerator'));"

# Count records in new tables
psql novelgenerator -c "SELECT
  (SELECT COUNT(*) FROM object_versions) as versions,
  (SELECT COUNT(*) FROM object_translations) as translations,
  (SELECT COUNT(*) FROM active_versions) as active_versions;"

# Check for objects without translations
psql novelgenerator -c "SELECT object_type, COUNT(*)
FROM active_versions av
WHERE NOT EXISTS (
  SELECT 1 FROM object_translations ot
  WHERE ot.object_type = av.object_type AND ot.object_id = av.object_id
)
GROUP BY object_type;"

# Analyze tables after migration
psql novelgenerator -c "ANALYZE object_translations; ANALYZE object_versions; ANALYZE active_versions;"
```

---

**Last Updated**: 2025-11-08
**Migration Version**: 006 → 007
**Estimated Completion**: 2-4 hours
