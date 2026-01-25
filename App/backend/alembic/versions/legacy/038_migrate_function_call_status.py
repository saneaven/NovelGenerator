"""migrate_function_call_status

Revision ID: 038
Revises: 037
Create Date: 2026-01-01

Migrate function call data from boolean-based status (isApplied, isRejected)
to enum-based status ('failed', 'pending', 'rejected', 'accepted').

Transforms:
- isRejected=true → status='rejected'
- isApplied=true + error → status='failed', failureType='execution'
- isApplied=true + no error → status='accepted'
- else → status='pending'

Also renames:
- appliedAt → acceptedAt
- error → reason
"""
from alembic import op

revision = '038'
down_revision = '037'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Migrate function_calls JSONB from boolean status to enum status.
    """
    # Update function_calls in agent_messages
    # For each function call in the array, transform the status fields
    # Use CTE to first identify rows with valid arrays
    op.execute("""
        WITH valid_rows AS (
            SELECT id
            FROM agent_messages
            WHERE function_calls IS NOT NULL
              AND jsonb_typeof(function_calls) = 'array'
        ),
        rows_with_data AS (
            SELECT id
            FROM valid_rows v
            JOIN agent_messages m USING (id)
            WHERE jsonb_array_length(m.function_calls) > 0
        )
        UPDATE agent_messages am
        SET function_calls = (
            SELECT jsonb_agg(
                CASE
                    -- Rejected
                    WHEN (fc->>'isRejected')::boolean = true THEN
                        fc - 'isApplied' - 'isRejected' - 'appliedAt' - 'error' - 'resultMessage'
                        || jsonb_build_object(
                            'status', 'rejected',
                            'reason', COALESCE(fc->>'error', fc->>'resultMessage'),
                            'acceptedAt', fc->'appliedAt'
                        )
                    -- Applied with error (failed)
                    WHEN (fc->>'isApplied')::boolean = true AND fc->>'error' IS NOT NULL THEN
                        fc - 'isApplied' - 'isRejected' - 'appliedAt' - 'error' - 'resultMessage'
                        || jsonb_build_object(
                            'status', 'failed',
                            'reason', fc->>'error',
                            'failureType', 'execution',
                            'acceptedAt', fc->'appliedAt'
                        )
                    -- Applied successfully (accepted)
                    WHEN (fc->>'isApplied')::boolean = true THEN
                        fc - 'isApplied' - 'isRejected' - 'appliedAt' - 'error' - 'resultMessage'
                        || jsonb_build_object(
                            'status', 'accepted',
                            'acceptedAt', fc->'appliedAt'
                        )
                    -- Pending (default)
                    ELSE
                        fc - 'isApplied' - 'isRejected' - 'appliedAt' - 'error' - 'resultMessage'
                        || jsonb_build_object('status', 'pending')
                END
            )
            FROM jsonb_array_elements(am.function_calls) AS fc
        )
        WHERE am.id IN (SELECT id FROM rows_with_data)
    """)


def downgrade() -> None:
    """
    Revert function_calls JSONB from enum status back to boolean status.
    """
    op.execute("""
        WITH valid_rows AS (
            SELECT id
            FROM agent_messages
            WHERE function_calls IS NOT NULL
              AND jsonb_typeof(function_calls) = 'array'
        ),
        rows_with_data AS (
            SELECT id
            FROM valid_rows v
            JOIN agent_messages m USING (id)
            WHERE jsonb_array_length(m.function_calls) > 0
        )
        UPDATE agent_messages am
        SET function_calls = (
            SELECT jsonb_agg(
                CASE
                    -- Rejected
                    WHEN fc->>'status' = 'rejected' THEN
                        fc - 'status' - 'reason' - 'failureType' - 'acceptedAt' - 'result'
                        || jsonb_build_object(
                            'isApplied', true,
                            'isRejected', true,
                            'appliedAt', fc->'acceptedAt',
                            'error', fc->>'reason'
                        )
                    -- Failed
                    WHEN fc->>'status' = 'failed' THEN
                        fc - 'status' - 'reason' - 'failureType' - 'acceptedAt' - 'result'
                        || jsonb_build_object(
                            'isApplied', true,
                            'isRejected', false,
                            'appliedAt', fc->'acceptedAt',
                            'error', fc->>'reason'
                        )
                    -- Accepted
                    WHEN fc->>'status' = 'accepted' THEN
                        fc - 'status' - 'reason' - 'failureType' - 'acceptedAt' - 'result'
                        || jsonb_build_object(
                            'isApplied', true,
                            'isRejected', false,
                            'appliedAt', fc->'acceptedAt'
                        )
                    -- Pending
                    ELSE
                        fc - 'status' - 'reason' - 'failureType' - 'acceptedAt' - 'result'
                        || jsonb_build_object(
                            'isApplied', false,
                            'isRejected', false
                        )
                END
            )
            FROM jsonb_array_elements(am.function_calls) AS fc
        )
        WHERE am.id IN (SELECT id FROM rows_with_data)
    """)
