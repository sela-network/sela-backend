import React from 'react';

import IconArrowRight from './Icons/IconArrowRight';
import IconGift from './Icons/IconGift';
import IconHistory from './Icons/IconHistory';
import IconSela from './Icons/IconSela';
import IconPhone from './Icons/IconPhone';
import IconReferral from './Icons/IconReferral';

import Color from '../style/Color';

const iconMap = {
  sela: IconSela,
  history: IconHistory,
  gift: IconGift,
  arrowRight: IconArrowRight,
  phone: IconPhone,
  referral: IconReferral,
};

const Icon = ({
  name,
  style,
  backgroundColor = Color.semiGray,
  borderColor = Color.semiGray,
  useBackground = true,
  ...props
}) => {
  const SelectedIcon = iconMap[name];

  if (!SelectedIcon) return null;

  // Define default styles
  const defaultStyle = {
    width: '24px',
    height: '24px',
    ...style, // Override default styles with passed-in `style` prop
  };

  return useBackground ? (
    <div
      style={{
        padding: 8,
        background: backgroundColor,
        border: '1px solid',
        borderColor: borderColor,
        borderRadius: 100,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <SelectedIcon style={defaultStyle} {...props} />
    </div>
  ) : (
    <SelectedIcon style={defaultStyle} {...props} />
  );
};

export default Icon;
