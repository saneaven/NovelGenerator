import React from 'react';
import type { ValidationError } from '../../api/promptService';

interface ValidationWarningsProps {
  errors: ValidationError[];
  warnings: ValidationError[];
}

const ValidationWarnings: React.FC<ValidationWarningsProps> = ({ errors, warnings }) => {
  if (errors.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="validation-messages">
      {errors.length > 0 && (
        <div className="validation-errors">
          <div className="validation-header error">
            <span className="icon">⚠️</span>
            <strong>Syntax Errors ({errors.length})</strong>
          </div>
          <ul className="validation-list">
            {errors.map((error, idx) => (
              <li key={idx} className="validation-item error">
                {error.line && error.column && (
                  <span className="location">Line {error.line}, Col {error.column}: </span>
                )}
                <span className="message">{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="validation-warnings">
          <div className="validation-header warning">
            <span className="icon">⚡</span>
            <strong>Warnings ({warnings.length})</strong>
          </div>
          <ul className="validation-list">
            {warnings.map((warning, idx) => (
              <li key={idx} className="validation-item warning">
                {warning.line && warning.column && (
                  <span className="location">Line {warning.line}, Col {warning.column}: </span>
                )}
                <span className="message">{warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ValidationWarnings;
