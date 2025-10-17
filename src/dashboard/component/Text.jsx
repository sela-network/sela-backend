import React from 'react';

const Text = ({
  size = 16, // Default size is 16px
  color = '#fff', // Default color is white
  weight = 'normal', // Default weight is normal
  decoration = 'none', // Default decoration is none
  textAlign = 'left', // Default text alignment is left
  children, // The text to display
  style = {}, // Additional custom styles
  onClick,
}) => {
  const fontWeightMap = {
    normal: 'normal',
    bold: 'bold',
    light: '400',
    semiBold: '600',
  };

  return (
    <span
      onClick={onClick}
      style={{
        fontSize: size,
        color: color,
        fontFamily: 'Urbanist',
        fontWeight: fontWeightMap[weight] || 'normal', // Use the weight map
        textDecoration: decoration,
        textAlign: textAlign,
        ...style, // Allow overriding styles
      }}
    >
      {children}
    </span>
  );
};

export default Text;
