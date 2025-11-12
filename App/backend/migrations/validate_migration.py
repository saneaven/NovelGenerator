"""
Validation Script: Verify Translation Data Migration Integrity

This script validates that the migration from old to new translation system was successful:
- All versions were migrated
- Translation cache correctly generated
- Active version pointers are correct
- No data loss occurred

Run this AFTER the data migration script.

Usage:
    python -m migrations.validate_migration
"""

import sys
import os
from collections import defaultdict

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from database import get_database_url
from models.db_models import StoryObjectVersion, ChapterContentVersion
from models.translation_models import ObjectVersion, ObjectTranslation, ActiveVersion


class MigrationValidator:
    """Validates translation data migration integrity"""

    def __init__(self, session):
        self.session = session
        self.errors = []
        self.warnings = []
        self.stats = {}

    def validate_all(self):
        """Run all validation checks"""
        print("=" * 80)
        print("MIGRATION VALIDATION")
        print("=" * 80)
        print()

        self.validate_version_counts()
        self.validate_active_versions()
        self.validate_translation_cache()
        self.validate_language_data_integrity()
        self.validate_version_numbers()
        self.validate_no_data_loss()

        print("\n" + "=" * 80)
        print("VALIDATION SUMMARY")
        print("=" * 80)

        if not self.errors and not self.warnings:
            print("✓ All validation checks passed!")
            print("\nMigration completed successfully with 100% data integrity.")
        else:
            if self.errors:
                print(f"\n✗ {len(self.errors)} ERRORS found:")
                for i, error in enumerate(self.errors, 1):
                    print(f"  {i}. {error}")

            if self.warnings:
                print(f"\n⚠ {len(self.warnings)} WARNINGS:")
                for i, warning in enumerate(self.warnings, 1):
                    print(f"  {i}. {warning}")

        print("\n" + "=" * 80)

    def validate_version_counts(self):
        """Ensure all versions were migrated"""
        print("1. Validating version counts...")

        # Story object versions
        old_story_count = self.session.query(StoryObjectVersion).count()
        new_story_count = self.session.query(ObjectVersion).filter(
            ObjectVersion.object_type != 'chapter_content'
        ).count()

        # Chapter content versions
        old_chapter_count = self.session.query(ChapterContentVersion).count()
        new_chapter_count = self.session.query(ObjectVersion).filter(
            ObjectVersion.object_type == 'chapter_content'
        ).count()

        total_old = old_story_count + old_chapter_count
        total_new = new_story_count + new_chapter_count

        self.stats['old_versions'] = total_old
        self.stats['new_versions'] = total_new

        print(f"  Old system: {old_story_count} story + {old_chapter_count} chapter = {total_old} total")
        print(f"  New system: {new_story_count} story + {new_chapter_count} chapter = {total_new} total")

        if total_old == total_new:
            print(f"  ✓ All {total_new} versions migrated\n")
        else:
            error = f"Version count mismatch: {total_old} old vs {total_new} new (missing {total_old - total_new})"
            self.errors.append(error)
            print(f"  ✗ {error}\n")

    def validate_active_versions(self):
        """Ensure active version pointers are correct"""
        print("2. Validating active version pointers...")

        # Count active versions in old system
        old_active_story = self.session.query(StoryObjectVersion).filter(
            StoryObjectVersion.is_active == True
        ).count()

        old_active_chapter = self.session.query(ChapterContentVersion).filter(
            ChapterContentVersion.is_active == True
        ).count()

        old_active_total = old_active_story + old_active_chapter

        # Count active version pointers in new system
        new_active_count = self.session.query(ActiveVersion).count()

        self.stats['old_active'] = old_active_total
        self.stats['new_active'] = new_active_count

        print(f"  Old system: {old_active_total} active versions")
        print(f"  New system: {new_active_count} active version pointers")

        if old_active_total == new_active_count:
            print(f"  ✓ All {new_active_count} active versions migrated\n")
        else:
            error = f"Active version mismatch: {old_active_total} old vs {new_active_count} new"
            self.errors.append(error)
            print(f"  ✗ {error}\n")

        # Validate that all active_version_id references exist
        orphaned_count = self.session.query(ActiveVersion).filter(
            ~ActiveVersion.active_version_id.in_(
                self.session.query(ObjectVersion.id)
            )
        ).count()

        if orphaned_count > 0:
            error = f"Found {orphaned_count} active version pointers with no matching version"
            self.errors.append(error)
            print(f"  ✗ {error}\n")

    def validate_translation_cache(self):
        """Ensure translation cache was correctly generated"""
        print("3. Validating translation cache...")

        # Count total translation entries
        translation_count = self.session.query(ObjectTranslation).count()
        self.stats['translations'] = translation_count

        print(f"  Total translation entries: {translation_count}")

        # Count active translations
        active_translations = self.session.query(ObjectTranslation).filter(
            ObjectTranslation.is_active == True
        ).count()

        print(f"  Active translations: {active_translations}")

        # Each object should have at most one active language
        objects_with_multiple_active = self.session.query(
            ObjectTranslation.object_type,
            ObjectTranslation.object_id,
            func.count(ObjectTranslation.id).label('active_count')
        ).filter(
            ObjectTranslation.is_active == True
        ).group_by(
            ObjectTranslation.object_type,
            ObjectTranslation.object_id
        ).having(
            func.count(ObjectTranslation.id) > 1
        ).count()

        if objects_with_multiple_active > 0:
            error = f"Found {objects_with_multiple_active} objects with multiple active languages"
            self.errors.append(error)
            print(f"  ✗ {error}")
        else:
            print(f"  ✓ No objects with multiple active languages")

        # Check for objects with no translations
        total_objects = self.session.query(ActiveVersion).count()
        objects_with_translations = self.session.query(
            ObjectTranslation.object_type,
            ObjectTranslation.object_id
        ).distinct().count()

        if total_objects != objects_with_translations:
            warning = f"Some objects have no translations: {total_objects} objects vs {objects_with_translations} with translations"
            self.warnings.append(warning)
            print(f"  ⚠ {warning}")
        else:
            print(f"  ✓ All {total_objects} objects have translations")

        print()

    def validate_language_data_integrity(self):
        """Ensure language data in translations matches version data"""
        print("4. Validating language data integrity...")

        # Sample check: verify a few random translations match their version data
        sample_size = min(100, self.session.query(ObjectTranslation).count())

        if sample_size == 0:
            print("  ⚠ No translations to validate\n")
            return

        translations = self.session.query(ObjectTranslation).limit(sample_size).all()

        mismatches = 0
        for translation in translations:
            # Find active version for this object
            active_version = self.session.query(ActiveVersion).filter(
                ActiveVersion.object_type == translation.object_type,
                ActiveVersion.object_id == translation.object_id
            ).first()

            if not active_version:
                continue

            # Get version data
            version = self.session.query(ObjectVersion).filter(
                ObjectVersion.id == active_version.active_version_id
            ).first()

            if not version:
                continue

            # Check if translation data matches version data for this language
            if translation.language in version.data:
                version_lang_data = version.data[translation.language]
                if translation.data != version_lang_data:
                    mismatches += 1

        if mismatches > 0:
            error = f"Found {mismatches} translation data mismatches in {sample_size} sample"
            self.errors.append(error)
            print(f"  ✗ {error}\n")
        else:
            print(f"  ✓ All {sample_size} sampled translations match version data\n")

    def validate_version_numbers(self):
        """Ensure version numbers are sequential"""
        print("5. Validating version number sequences...")

        # Group by object and check for gaps
        version_groups = defaultdict(list)

        versions = self.session.query(ObjectVersion).order_by(
            ObjectVersion.object_type,
            ObjectVersion.object_id,
            ObjectVersion.version_number
        ).all()

        for version in versions:
            key = (version.object_type, version.object_id)
            version_groups[key].append(version.version_number)

        gaps_found = 0
        wrong_start = 0

        for (obj_type, obj_id), version_numbers in version_groups.items():
            # Should start at 1
            if version_numbers[0] != 1:
                wrong_start += 1

            # Should be sequential
            expected = list(range(1, len(version_numbers) + 1))
            if version_numbers != expected:
                gaps_found += 1

        if gaps_found > 0:
            error = f"Found {gaps_found} objects with non-sequential version numbers"
            self.errors.append(error)
            print(f"  ✗ {error}")
        else:
            print(f"  ✓ All version numbers are sequential")

        if wrong_start > 0:
            error = f"Found {wrong_start} objects not starting at version 1"
            self.errors.append(error)
            print(f"  ✗ {error}")
        else:
            print(f"  ✓ All version sequences start at 1")

        print()

    def validate_no_data_loss(self):
        """Ensure no language data was lost"""
        print("6. Validating no data loss...")

        # Count total languages in old system
        old_language_count = 0

        old_story_versions = self.session.query(StoryObjectVersion).all()
        for version in old_story_versions:
            if version.data and isinstance(version.data, dict):
                old_language_count += len(version.data)

        old_chapter_versions = self.session.query(ChapterContentVersion).all()
        for version in old_chapter_versions:
            if version.data and isinstance(version.data, dict):
                old_language_count += len(version.data)

        # Count total languages in new system
        new_language_count = 0

        new_versions = self.session.query(ObjectVersion).all()
        for version in new_versions:
            if version.data and isinstance(version.data, dict):
                new_language_count += len(version.data)

        self.stats['old_languages'] = old_language_count
        self.stats['new_languages'] = new_language_count

        print(f"  Old system: {old_language_count} language entries across all versions")
        print(f"  New system: {new_language_count} language entries across all versions")

        if old_language_count == new_language_count:
            print(f"  ✓ No language data lost\n")
        else:
            error = f"Language data mismatch: {old_language_count} old vs {new_language_count} new (lost {old_language_count - new_language_count})"
            self.errors.append(error)
            print(f"  ✗ {error}\n")


def main():
    """Run validation"""
    print("\nConnecting to database...")

    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        validator = MigrationValidator(session)
        validator.validate_all()

        # Exit with error code if validation failed
        if validator.errors:
            sys.exit(1)

    except Exception as e:
        print(f"\n✗ Validation failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


if __name__ == '__main__':
    main()
