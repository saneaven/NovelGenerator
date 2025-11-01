"""Template validation service for prompt templates"""
import re
from typing import List, Set, Tuple
from ..schemas.prompts import ValidationError, ValidationResult


from . import template_registry


class TemplateValidator:
    """Validates Handlebars-like template syntax in prompts"""

    @staticmethod
    def validate(content: str) -> ValidationResult:
        """
        Validate template syntax and return errors/warnings.

        Checks for:
        - Unclosed conditional blocks ({{#if::...}} without {{/if}})
        - Malformed syntax (missing braces, colons, etc.)
        - Unknown variables (warnings only)
        - Unknown conditionals (warnings only)
        """
        errors: List[ValidationError] = []
        warnings: List[ValidationError] = []

        # Split content into lines for line-based error reporting
        lines = content.split('\n')

        known_variables = template_registry.get_known_variables()
        known_conditionals = template_registry.get_known_conditionals()
        known_context_keys = template_registry.get_known_contexts()

        # Check for unclosed conditional blocks
        unclosed = TemplateValidator._check_unclosed_conditionals(content, lines)
        errors.extend(unclosed)

        # Check for malformed tags
        malformed = TemplateValidator._check_malformed_tags(content, lines)
        errors.extend(malformed)

        # Check for unknown variables (warnings)
        unknown_vars = TemplateValidator._check_unknown_variables(content, lines, known_variables)
        warnings.extend(unknown_vars)

        # Check for unknown conditionals (warnings)
        unknown_conds = TemplateValidator._check_unknown_conditionals(content, lines, known_conditionals)
        warnings.extend(unknown_conds)

        # Check for unknown context keys (warnings)
        unknown_context = TemplateValidator._check_unknown_context_keys(content, lines, known_context_keys)
        warnings.extend(unknown_context)

        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )

    @staticmethod
    def _check_unclosed_conditionals(content: str, lines: List[str]) -> List[ValidationError]:
        """Check for unclosed {{#if::...}} blocks"""
        errors = []
        stack = []  # Stack of (line, col, conditional_name)

        # Find all conditional tags (with optional ! prefix for negation)
        if_pattern = re.compile(r'\{\{#if::(!?)(\w+)\}\}')
        endif_pattern = re.compile(r'\{\{/if\}\}')

        for line_idx, line in enumerate(lines):
            line_num = line_idx + 1

            # Find all opening conditionals in this line
            for match in if_pattern.finditer(line):
                negation = match.group(1)
                conditional_name = match.group(2)
                full_name = f"{negation}{conditional_name}"
                stack.append((line_num, match.start(), full_name))

            # Find all closing conditionals in this line
            for match in endif_pattern.finditer(line):
                if not stack:
                    errors.append(ValidationError(
                        line=line_num,
                        column=match.start(),
                        message="Closing {{/if}} without matching opening {{#if::...}}",
                        severity="error"
                    ))
                else:
                    stack.pop()

        # Any remaining items in stack are unclosed
        for line_num, col, cond_name in stack:
            errors.append(ValidationError(
                line=line_num,
                column=col,
                message=f"Unclosed conditional block {{{{#if::{cond_name}}}}}. Missing {{{{/if}}}}.",
                severity="error"
            ))

        return errors

    @staticmethod
    def _check_malformed_tags(content: str, lines: List[str]) -> List[ValidationError]:
        """Check for malformed template tags"""
        errors = []

        # Pattern for any template tag
        tag_pattern = re.compile(r'\{\{([^}]*)\}\}')

        for line_idx, line in enumerate(lines):
            line_num = line_idx + 1

            # Find all tags in this line
            for match in tag_pattern.finditer(line):
                tag_content = match.group(1)
                col = match.start()

                # Check variable tags: {{var::name}}
                if tag_content.startswith('var::'):
                    var_name = tag_content[5:]
                    if not var_name or not var_name.replace('_', '').isalnum():
                        errors.append(ValidationError(
                            line=line_num,
                            column=col,
                            message=f"Malformed variable tag: {{{{var::{var_name}}}}}",
                            severity="error"
                        ))

                # Check context tags: {{context::name}}
                elif tag_content.startswith('context::'):
                    context_key = tag_content[9:]
                    if not context_key or not context_key.replace('_', '').isalnum():
                        errors.append(ValidationError(
                            line=line_num,
                            column=col,
                            message=f"Malformed context tag: {{{{context::{context_key}}}}}",
                            severity="error"
                        ))

                # Check conditional opening tags: {{#if::condition}} or {{#if::!condition}}
                elif tag_content.startswith('#if::'):
                    cond_name = tag_content[5:]
                    # Handle optional ! prefix for negation
                    if cond_name.startswith('!'):
                        cond_name = cond_name[1:]
                    if not cond_name or not cond_name.replace('_', '').isalnum():
                        errors.append(ValidationError(
                            line=line_num,
                            column=col,
                            message=f"Malformed conditional tag: {{{{#if::{tag_content[5:]}}}}}",
                            severity="error"
                        ))

                # Check closing tags: {{/if}}
                elif tag_content == '/if':
                    pass  # Valid closing tag

                # Unknown tag format
                elif tag_content.strip():
                    # Check if it looks like a malformed attempt
                    if '::' in tag_content or tag_content.startswith('#') or tag_content.startswith('/'):
                        errors.append(ValidationError(
                            line=line_num,
                            column=col,
                            message=f"Malformed template tag: {{{{{tag_content}}}}}",
                            severity="error"
                        ))

        # Check for incomplete tags (missing closing braces)
        incomplete = re.finditer(r'\{\{[^}]*$', content)
        for match in incomplete:
            line_num = content[:match.start()].count('\n') + 1
            col = match.start() - content[:match.start()].rfind('\n') - 1
            errors.append(ValidationError(
                line=line_num,
                column=col,
                message="Incomplete template tag (missing closing braces)",
                severity="error"
            ))

        return errors

    @staticmethod
    def _check_unknown_variables(content: str, lines: List[str], known_variables: Set[str]) -> List[ValidationError]:
        """Check for unknown variable names (warnings only)"""
        warnings = []

        var_pattern = re.compile(r'\{\{var::(\w+)\}\}')

        for line_idx, line in enumerate(lines):
            line_num = line_idx + 1

            for match in var_pattern.finditer(line):
                var_name = match.group(1)
                if var_name not in known_variables:
                    warnings.append(ValidationError(
                        line=line_num,
                        column=match.start(),
                        message=f"Unknown variable '{{{{var::{var_name}}}}}'. This may cause rendering issues.",
                        severity="warning"
                    ))

        return warnings

    @staticmethod
    def _check_unknown_conditionals(content: str, lines: List[str], known_conditionals: Set[str]) -> List[ValidationError]:
        """Check for unknown conditional names (warnings only)"""
        warnings = []

        # Match conditionals with optional ! prefix for negation
        cond_pattern = re.compile(r'\{\{#if::(!?)(\w+)\}\}')

        for line_idx, line in enumerate(lines):
            line_num = line_idx + 1

            for match in cond_pattern.finditer(line):
                negation = match.group(1)
                cond_name = match.group(2)
                if cond_name not in known_conditionals:
                    full_cond = f"{negation}{cond_name}"
                    warnings.append(ValidationError(
                        line=line_num,
                        column=match.start(),
                        message=f"Unknown conditional '{{{{#if::{full_cond}}}}}'. This condition may not work as expected.",
                        severity="warning"
                    ))

        return warnings

    @staticmethod
    def _check_unknown_context_keys(content: str, lines: List[str], known_context_keys: Set[str]) -> List[ValidationError]:
        """Check for unknown context keys (warnings only)"""
        warnings = []

        context_pattern = re.compile(r'\{\{context::(\w+)\}\}')

        for line_idx, line in enumerate(lines):
            line_num = line_idx + 1

            for match in context_pattern.finditer(line):
                context_key = match.group(1)
                if context_key not in known_context_keys:
                    warnings.append(ValidationError(
                        line=line_num,
                        column=match.start(),
                        message=f"Unknown context key '{{{{context::{context_key}}}}}'. This may cause rendering issues.",
                        severity="warning"
                    ))

        return warnings


# Export validator instance
validator = TemplateValidator()
