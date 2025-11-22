"""
Data Migration Script: Old Translation System → New Three-Layer Architecture

This script migrates data from the old dual-storage system to the new three-layer system:
- StoryObjectVersion → object_versions + object_translations + active_versions
- ChapterContentVersion → object_versions + object_translations + active_versions

Run this AFTER applying the 006_multilingual_redesign Alembic migration.

Usage:
    python -m migrations.migrate_translation_data
"""

import sys
import os
from datetime import datetime
from collections import defaultdict
from uuid import uuid4

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from database import get_database_url
from models.db_models import (
    StoryObjectVersion, ChapterContentVersion, ChapterContent,
    BasicInfo, Character, Organization, Location, LorebookEntry,
    Act, Chapter, UserSettings
)
from models.translation_models import ObjectVersion, ObjectTranslation, ActiveVersion

 
class TranslationDataMigrator:
    """Migrates translation data from old system to new three-layer architecture"""

    def __init__(self, session):
        self.session = session
        self.stats = {
            'story_object_versions_migrated': 0,
            'chapter_content_versions_migrated': 0,
            'object_versions_created': 0,
            'object_translations_created': 0,
            'active_versions_created': 0,
            'errors': []
        }

    def migrate_all(self):
        """Run complete migration"""
        print("=" * 80)
        print("TRANSLATION DATA MIGRATION")
        print("=" * 80)
        print()

        try:
            print("Step 1: Migrating StoryObjectVersion → ObjectVersion...")
            self.migrate_story_object_versions()
            print(f"  ✓ Migrated {self.stats['story_object_versions_migrated']} story object versions\n")

            print("Step 2: Migrating ChapterContentVersion → ObjectVersion...")
            self.migrate_chapter_content_versions()
            print(f"  ✓ Migrated {self.stats['chapter_content_versions_migrated']} chapter content versions\n")

            print("Step 3: Generating translation cache...")
            self.generate_translation_cache()
            print(f"  ✓ Created {self.stats['object_translations_created']} translation entries\n")

            print("Step 4: Creating active version pointers...")
            self.create_active_version_pointers()
            print(f"  ✓ Created {self.stats['active_versions_created']} active version pointers\n")

            self.session.commit()

            print("=" * 80)
            print("MIGRATION SUMMARY")
            print("=" * 80)
            print(f"Story object versions migrated:   {self.stats['story_object_versions_migrated']}")
            print(f"Chapter content versions migrated: {self.stats['chapter_content_versions_migrated']}")
            print(f"Object versions created:           {self.stats['object_versions_created']}")
            print(f"Translation entries created:       {self.stats['object_translations_created']}")
            print(f"Active version pointers created:   {self.stats['active_versions_created']}")
            print(f"Errors:                            {len(self.stats['errors'])}")
            print()

            if self.stats['errors']:
                print("ERRORS:")
                for error in self.stats['errors']:
                    print(f"  - {error}")
            else:
                print("✓ Migration completed successfully!")

        except Exception as e:
            self.session.rollback()
            print(f"\n✗ Migration failed: {e}")
            raise

    def migrate_story_object_versions(self):
        """Migrate StoryObjectVersion → ObjectVersion"""
        # Group versions by object
        versions_by_object = defaultdict(list)

        old_versions = self.session.query(StoryObjectVersion).order_by(
            StoryObjectVersion.object_id,
            StoryObjectVersion.timestamp
        ).all()

        for old_version in old_versions:
            key = (old_version.object_type, old_version.object_id)
            versions_by_object[key].append(old_version)

        # Migrate each object's versions with sequential numbering
        for (object_type, object_id), versions in versions_by_object.items():
            for version_num, old_version in enumerate(versions, start=1):
                try:
                    new_version = ObjectVersion(
                        id=old_version.id,  # Keep same ID for reference
                        object_type=object_type,
                        object_id=object_id,
                        version_number=version_num,
                        data=old_version.data,  # Copy multilingual JSONB as-is
                        user_request=old_version.user_request,
                        created_by=None,  # No user tracking in old system
                        created_at=old_version.timestamp
                    )
                    self.session.add(new_version)
                    self.stats['object_versions_created'] += 1
                    self.stats['story_object_versions_migrated'] += 1

                except Exception as e:
                    error_msg = f"Failed to migrate StoryObjectVersion {old_version.id}: {e}"
                    self.stats['errors'].append(error_msg)
                    print(f"  ✗ {error_msg}")

    def migrate_chapter_content_versions(self):
        """Migrate ChapterContentVersion → ObjectVersion"""
        # Group versions by chapter_content_id
        versions_by_content = defaultdict(list)

        old_versions = self.session.query(ChapterContentVersion).order_by(
            ChapterContentVersion.chapter_content_id,
            ChapterContentVersion.timestamp
        ).all()

        for old_version in old_versions:
            versions_by_content[old_version.chapter_content_id].append(old_version)

        # Migrate each chapter content's versions
        for chapter_content_id, versions in versions_by_content.items():
            for version_num, old_version in enumerate(versions, start=1):
                try:
                    new_version = ObjectVersion(
                        id=old_version.id,  # Keep same ID
                        object_type='chapter_content',
                        object_id=chapter_content_id,
                        version_number=version_num,
                        data=old_version.data,  # Copy multilingual JSONB
                        user_request=old_version.user_request,
                        created_by=None,
                        created_at=old_version.timestamp
                    )
                    self.session.add(new_version)
                    self.stats['object_versions_created'] += 1
                    self.stats['chapter_content_versions_migrated'] += 1

                except Exception as e:
                    error_msg = f"Failed to migrate ChapterContentVersion {old_version.id}: {e}"
                    self.stats['errors'].append(error_msg)
                    print(f"  ✗ {error_msg}")

    def generate_translation_cache(self):
        """Generate object_translations from active object_versions"""
        # Get default language for is_active flag
        default_language = 'English'
        settings = self.session.query(UserSettings).first()
        if settings and settings.primary_language:
            default_language = settings.primary_language

        # Get all active versions from OLD system
        active_story_versions = self.session.query(StoryObjectVersion).filter(
            StoryObjectVersion.is_active == True
        ).all()

        for old_version in active_story_versions:
            self._create_translations_from_version(
                object_type=old_version.object_type,
                object_id=old_version.object_id,
                version_data=old_version.data,
                default_language=default_language
            )

        # Chapter content versions
        active_chapter_versions = self.session.query(ChapterContentVersion).filter(
            ChapterContentVersion.is_active == True
        ).all()

        for old_version in active_chapter_versions:
            self._create_translations_from_version(
                object_type='chapter_content',
                object_id=old_version.chapter_content_id,
                version_data=old_version.data,
                default_language=default_language
            )

    def _create_translations_from_version(self, object_type, object_id, version_data, default_language):
        """Extract individual languages from version JSONB and create translation cache entries"""
        if not version_data or not isinstance(version_data, dict):
            return

        for language, language_data in version_data.items():
            if not isinstance(language_data, dict):
                continue

            try:
                translation = ObjectTranslation(
                    id=uuid4(),
                    object_type=object_type,
                    object_id=object_id,
                    language=language,
                    data=language_data,  # Extract just this language's data
                    is_active=(language == default_language),  # Mark default language as active
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                self.session.add(translation)
                self.stats['object_translations_created'] += 1

            except Exception as e:
                error_msg = f"Failed to create translation for {object_type}:{object_id} {language}: {e}"
                self.stats['errors'].append(error_msg)
                print(f"  ✗ {error_msg}")

    def create_active_version_pointers(self):
        """Create active_versions entries pointing to active versions"""

        # Story objects
        active_story_versions = self.session.query(StoryObjectVersion).filter(
            StoryObjectVersion.is_active == True
        ).all()

        for old_version in active_story_versions:
            try:
                # Find corresponding new version (same ID)
                new_version = self.session.query(ObjectVersion).filter(
                    ObjectVersion.id == old_version.id
                ).first()

                if new_version:
                    active_version = ActiveVersion(
                        object_type=old_version.object_type,
                        object_id=old_version.object_id,
                        active_version_id=new_version.id,
                        updated_at=datetime.utcnow()
                    )
                    self.session.add(active_version)
                    self.stats['active_versions_created'] += 1

            except Exception as e:
                error_msg = f"Failed to create active version for {old_version.object_type}:{old_version.object_id}: {e}"
                self.stats['errors'].append(error_msg)
                print(f"  ✗ {error_msg}")

        # Chapter content
        active_chapter_versions = self.session.query(ChapterContentVersion).filter(
            ChapterContentVersion.is_active == True
        ).all()

        for old_version in active_chapter_versions:
            try:
                new_version = self.session.query(ObjectVersion).filter(
                    ObjectVersion.id == old_version.id
                ).first()

                if new_version:
                    active_version = ActiveVersion(
                        object_type='chapter_content',
                        object_id=old_version.chapter_content_id,
                        active_version_id=new_version.id,
                        updated_at=datetime.utcnow()
                    )
                    self.session.add(active_version)
                    self.stats['active_versions_created'] += 1

            except Exception as e:
                error_msg = f"Failed to create active version for chapter_content:{old_version.chapter_content_id}: {e}"
                self.stats['errors'].append(error_msg)
                print(f"  ✗ {error_msg}")


def main():
    """Run migration"""
    print("\nConnecting to database...")

    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Check if new tables exist
        print("Checking if migration tables exist...")
        result = session.execute(text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'object_versions')"
        ))
        if not result.scalar():
            print("\n✗ Error: object_versions table does not exist!")
            print("  Please run the Alembic migration first: alembic upgrade head")
            return

        print("✓ Migration tables found\n")

        # Run migration
        migrator = TranslationDataMigrator(session)
        migrator.migrate_all()

    except Exception as e:
        print(f"\n✗ Migration failed with error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        session.close()


if __name__ == '__main__':
    main()
