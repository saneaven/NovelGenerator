import React from 'react';
import { useAuthenticatedImageSrc } from '../../utils/authenticatedImage';

export type AuthenticatedImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
};

export const AuthenticatedImage = React.forwardRef<HTMLImageElement, AuthenticatedImageProps>(
  function AuthenticatedImage({ src, alt = '', ...props }, ref) {
    const resolvedSrc = useAuthenticatedImageSrc(src);

    return (
      <img
        ref={ref}
        {...props}
        src={resolvedSrc ?? undefined}
        alt={alt}
      />
    );
  }
);

export default AuthenticatedImage;
