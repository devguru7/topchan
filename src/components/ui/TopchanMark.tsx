import React from 'react';

interface TopchanMarkProps {
  className?: string;
  size?: number;
}

/**
 * Topchan Craft geometric emblem:
 * Combines the silhouette of an Uzbek topchan platform with a crisp panjara
 * lattice diamond inside a warm Tashkent Terracotta rounded frame.
 */
export const TopchanMark: React.FC<TopchanMarkProps> = ({ className = '', size = 28 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="28" height="28" rx="7" fill="var(--brand-primary, #C2592B)" />
      {/* Panjara architectural lattice diamond */}
      <path
        d="M14 5.5L19.5 11L14 16.5L8.5 11L14 5.5Z"
        stroke="#FAF9F6"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="11" r="1.5" fill="#FAF9F6" />
      {/* Topchan low platform + side bolsters + grounded legs */}
      <path
        d="M5.5 18.5H22.5"
        stroke="#FAF9F6"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.5 15.5V18.5M20.5 15.5V18.5"
        stroke="#FAF9F6"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8 18.5V22M20 18.5V22"
        stroke="#FAF9F6"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
};
