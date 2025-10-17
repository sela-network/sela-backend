import React from 'react';
import { Space, Avatar } from 'antd';

import Text from './Text';
import Color from '../style/Color';

const Header = ({ title, principalId, setProfileMenu }) => {
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
      <Text children={title} size={24} weight="semiBold" />
      <Space>
        <Text children={'' + principalId} size={14} />

        <Avatar
          onClick={setProfileMenu}
          style={{
            backgroundColor: Color.semiGray,
          }}
        >
          <Text children="A" size={18} weight="semiBold" />
        </Avatar>
      </Space>
    </div>
  );
};

export default Header;
