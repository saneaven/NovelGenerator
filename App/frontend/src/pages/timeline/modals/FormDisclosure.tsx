import React, { useState } from 'react';
import { ChevronRight } from '../../../components/icons';

interface FormDisclosureProps {
  label: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

/** Plain collapsible form section (no selection checkbox, unlike CollapsibleSection). */
const FormDisclosure: React.FC<FormDisclosureProps> = ({ label, defaultExpanded = false, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="tl-form__disclosure">
      <button
        type="button"
        className="tl-form__disclosure-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <ChevronRight size="sm" className={`tl-form__disclosure-chevron ${expanded ? 'tl-form__disclosure-chevron--open' : ''}`} />
        {label}
      </button>
      {expanded && <div className="tl-form__disclosure-body">{children}</div>}
    </div>
  );
};

export default FormDisclosure;
