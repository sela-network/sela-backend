import React from 'react';
import { Modal, Avatar, Button } from 'antd';

import { Text, Spacing } from './index';
import Color from '../style/Color';

const HeaderModal = ({ open, onCancel, logout }) => {
  return (
    <>
      <Modal
        open={open}
        onCancel={() => onCancel(false)}
        footer={null}
        closable={false}
        style={{
          position: 'absolute',
          top: 100,
          right: 24,
          borderRadius: 30,
        }}
        width={333}
        height={382}
      >
        <div
          style={{
            padding: 12,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
          }}
        >
          <Avatar
            style={{
              backgroundColor: Color.semiGray,
            }}
            size={48}
          >
            <Text children="A" size={18} weight="semiBold" />
          </Avatar>
          <Spacing margin={16} />
          <Text children={'User ID'} size={18} color="#000" weight="semiBold" />
          <Spacing margin={16} />
          <Button
            shape="round"
            size={16}
            style={{
              backgroundColor: '#000',
              borderColor: '#000',
              width: 301,
              height: 52,
            }}
          >
            <Text children={'Wallet Connect'} size={16} weight="semiBold" />
          </Button>
          <Spacing margin={16} />
          <Text
            children={'Logout'}
            size={16}
            color="#000"
            weight="semiBold"
            decoration="underline"
            onClick={logout}
          />
          <Spacing margin={16} />
          <Text
            children={'Delete Account'}
            size={16}
            color="#000"
            weight="semiBold"
            decoration="underline"
          />
        </div>
      </Modal>
    </>
  );
};

export default HeaderModal;
