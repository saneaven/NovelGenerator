"""
Fix malformed message content in the database.

This script migrates messages that have:
1. Empty or missing contentParts
2. Old format with direct 'content' field
3. Malformed data structures

Usage:
    python -m scripts.fix_message_content
"""

import sys
import os
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models.db_models import ChatMessage
from database import DATABASE_URL


def fix_message_content(session):
    """Fix all messages with malformed content"""

    messages = session.query(ChatMessage).all()
    fixed_count = 0
    error_count = 0

    print(f"Checking {len(messages)} messages...")

    for message in messages:
        try:
            if not message.data:
                print(f"Message {message.id} has no data, creating empty data...")
                message.data = {"English": {"contentParts": [{"type": "content", "text": ""}]}}
                session.add(message)
                fixed_count += 1
                continue

            modified = False

            # Check each language in the data
            for language, lang_data in list(message.data.items()):
                if not isinstance(lang_data, dict):
                    print(f"Message {message.id} has invalid data for {language}, fixing...")
                    message.data[language] = {"contentParts": [{"type": "content", "text": ""}]}
                    modified = True
                    continue

                # Check if contentParts exists
                if 'contentParts' not in lang_data:
                    # Check if old 'content' field exists
                    if 'content' in lang_data and isinstance(lang_data['content'], str):
                        print(f"Message {message.id} has old format for {language}, migrating...")
                        new_data = {
                            "contentParts": [{"type": "content", "text": lang_data['content']}]
                        }
                        if 'thinking_details' in lang_data:
                            new_data['thinking_details'] = lang_data['thinking_details']
                        message.data[language] = new_data
                        modified = True
                    else:
                        # No content at all, create empty
                        print(f"Message {message.id} has no content for {language}, creating empty...")
                        message.data[language] = {"contentParts": [{"type": "content", "text": ""}]}
                        modified = True
                elif not isinstance(lang_data['contentParts'], list):
                    # contentParts is not a list, fix it
                    print(f"Message {message.id} has invalid contentParts for {language}, fixing...")
                    message.data[language]['contentParts'] = [{"type": "content", "text": ""}]
                    modified = True
                elif len(lang_data['contentParts']) == 0:
                    # Empty contentParts list, add empty content
                    print(f"Message {message.id} has empty contentParts for {language}, adding empty content...")
                    message.data[language]['contentParts'] = [{"type": "content", "text": ""}]
                    modified = True

            if modified:
                # Mark as modified so SQLAlchemy knows to update it
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(message, "data")
                session.add(message)
                fixed_count += 1

        except Exception as e:
            print(f"Error fixing message {message.id}: {e}")
            import traceback
            traceback.print_exc()
            error_count += 1

    if fixed_count > 0:
        print(f"\nCommitting changes for {fixed_count} messages...")
        session.commit()
        print("✓ Changes committed successfully")
    else:
        print("\n✓ No messages needed fixing")

    if error_count > 0:
        print(f"⚠ {error_count} messages had errors and were skipped")

    return fixed_count, error_count


def main():
    """Main entry point"""
    print("=" * 60)
    print("Message Content Fix Script")
    print("=" * 60)
    print()

    # Get database URL
    print(f"Connecting to database: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'database'}...")

    # Create engine and session
    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        fixed, errors = fix_message_content(session)
        print()
        print("=" * 60)
        print(f"Summary: {fixed} messages fixed, {errors} errors")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        session.rollback()
        return 1
    finally:
        session.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
