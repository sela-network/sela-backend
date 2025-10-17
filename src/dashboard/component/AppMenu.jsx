import React from 'react';
import { Space } from 'antd';

import { Text, Icon } from './index';
import Color from '../style/Color';

const AppMenu = ({ leftIcon, text, isActive }) => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: '32px',
      }}
    >
      <Space>
        <Icon name={leftIcon} fillColor={isActive ? Color.yellow : 'white'} />
        <Text
          children={text}
          size={18}
          color={isActive ? Color.yellow : 'white'}
          weight="semiBold"
        />
      </Space>
      <Icon
        name="arrowRight"
        backgroundColor={Color.black13}
        style={{ width: 16, height: 16 }}
      />
    </div>
  );
};

export default AppMenu;
