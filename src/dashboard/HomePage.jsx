import React, { useEffect, useState } from 'react';
import { useAuth } from './use-auth-client';

import { Nav, Spacing, Header, HeaderModal, Column } from './component';
import { Dashboard, RewardHistory, RewardProgram } from './pages';

import { Layout } from 'antd';
const { Content } = Layout;

const HomePage = () => {
  const [menuItems, setMenuItems] = useState([]);
  const [selectedMenu, setSelectedMenu] = useState({
    leftIcon: 'sela',
    text: 'Dashboard',
    children: <Dashboard />,
  });
  const { nodeActor, logout } = useAuth();

  const [principalId, setPrincipalId] = useState(null);
  const [userData, setUserData] = useState({});

  const [rewardHistories, setRewardHistories] = useState([]);

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  useEffect(() => {
    const getPrincipalId = async () => {
      const whoami = await nodeActor.whoami();
      setPrincipalId(whoami);

      const rewardHistories = await nodeActor.getUserRewardHistory(
        whoami.toText()
      );

      const rewards = rewardHistories.ok ?? []
      setRewardHistories(rewards);

      setMenuItems([
        {
          leftIcon: 'sela',
          text: 'Dashboard',
          children: <Dashboard rewardHistories={rewards} />,
        },
        {
          leftIcon: 'history',
          text: 'Reward History',
          children: <RewardHistory rewardHistories={rewards} />,
        },
        {
          leftIcon: 'gift',
          text: 'Reward Program',
          children: <RewardProgram />,
        },
      ]);

      const userData = await nodeActor.login(whoami.toText());
      setUserData(userData.ok);
    };

    // Call the async function
    getPrincipalId();
  }, []);

  const handleMenuClick = (menu) => {
    setSelectedMenu(menu);
  };

  const setProfileMenu = () => {
    setShowProfileMenu(!showProfileMenu);
  };

  const handleMoreClick = () => {
    setSelectedMenu(menuItems[1]);
  };

  return (
    <>
      <Layout style={{ minHeight: '100vh' }}>
        <Nav
          menuItems={menuItems}
          onMenuClick={handleMenuClick}
          selectedMenu={selectedMenu}
        />

        <Layout style={{ background: '#000', marginLeft: 350 }}>
          <Content
            style={{
              padding: '20px',
              overflow: 'auto', // Allows scrolling when content is too large
            }}
          >
            <Column>
              <Header
                title={selectedMenu.text}
                principalId={principalId}
                setProfileMenu={setProfileMenu}
              />
              <HeaderModal
                open={showProfileMenu}
                onCancel={setShowProfileMenu}
                logout={logout}
              />
              <Spacing margin={32} />
              {selectedMenu.text === 'Dashboard' ? (
                <Dashboard
                  handleMoreClick={handleMoreClick}
                  userData={userData}
                  rewardHistories={rewardHistories}
                />
              ) : (
                selectedMenu.children
              )}
            </Column>
          </Content>
        </Layout>
      </Layout>
    </>
  );
};

export default HomePage;
