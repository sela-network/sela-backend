/*
 * File: IconReferral.jsx
 * Project: internet_identity_integration
 * File Created: Wednesday, 4th December 2024 9:34:14 am
 * Author: Ananda Yudhistira (anandabayu12@gmail.com)
 * -----
 * Last Modified: Tuesday, 24th December 2024 10:49:46 am
 * Modified By: Ananda Yudhistira (anandabayu12@gmail.com>)
 * -----
 * Copyright 2024 Ananda Yudhistira
 */
import React from 'react';

export default function IconGift({
  fillColor = 'white',
  style = {},
  ...props
}) {
  return (
    <svg
      width="22"
      height="21"
      viewBox="0 0 22 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 19.5V17.5C15 16.4391 14.5786 15.4217 13.8284 14.6716C13.0783 13.9214 12.0609 13.5 11 13.5H5C3.93913 13.5 2.92172 13.9214 2.17157 14.6716C1.42143 15.4217 1 16.4391 1 17.5V19.5"
        stroke={fillColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 9.5C10.2091 9.5 12 7.70914 12 5.5C12 3.29086 10.2091 1.5 8 1.5C5.79086 1.5 4 3.29086 4 5.5C4 7.70914 5.79086 9.5 8 9.5Z"
        stroke={fillColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 6.5V12.5"
        stroke={fillColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 9.5H15"
        stroke={fillColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
