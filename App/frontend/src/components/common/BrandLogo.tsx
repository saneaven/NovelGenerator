import React from 'react';
import './BrandLogo.css';

interface BrandLogoProps {
  className?: string;
  alt?: string;
}

const LOGO_MASK_SRC = `${import.meta.env.BASE_URL}${encodeURI('Novel Buds Icon Text.svg')}`;

const BrandLogo: React.FC<BrandLogoProps> = ({ className = '', alt = 'Novel Buds' }) => {
  const wrapperClassName = className ? `brand-logo ${className}` : 'brand-logo';

  return (
    <span
      className={wrapperClassName}
      role="img"
      aria-label={alt}
      style={
        {
          '--brand-logo-mask': `url("${LOGO_MASK_SRC}")`,
        } as React.CSSProperties
      }
    />
  );
};

export default BrandLogo;
