import React from 'react';

export default function IconArrowRight({
  fillColor = 'white',
  style = {},
  ...props
}) {
  return (
    <svg
      width="7"
      height="12"
      viewBox="0 0 7 12"
      fill="none"
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M1 1.33325L5.66667 5.99992L1 10.6666"
        stroke={fillColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
