import { Alert, Breadcrumb, Button, Space, Typography } from 'antd';
import Cookie from 'js-cookie';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import MarkdownSnippet from '../components/MarkdownSnippet';
import SpotifyAuthButton from '../components/SpotifyAuthButton';
import { ClientId, RedirectUri } from '../utils/Constants';

const { Text, Title } = Typography;

export default function Home(): JSX.Element {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<string | undefined>(undefined);
    const error = router.query['error'];

    useEffect(() => {
        // Read 'spotifyuser' cookie
        const user = Cookie.get('spotifyuser');
        if (user) {
            setCurrentUser(user);
        }
    });

    const handleClearCreds = () => {
        Cookie.remove('spotifyuser');
        window.location.reload();
    };

    return (
        <div className="container">
            <Head>
                <title>Spotify Recently Played README Generator</title>
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <Breadcrumb separator=">" style={{ marginBottom: 25 }}>
                <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
            </Breadcrumb>

            <div>
                <Title level={2}>Spotify Recently Played README Generator</Title>
                {error && <Alert message="Error" description={error} type="error" style={{ marginBottom: 18 }} />}

                {!currentUser ? (
                    <Space className="vert-space" direction="vertical" size="middle">
                        <Text>Get started by authorizing the app below.</Text>
                        <SpotifyAuthButton clientId={ClientId} redirectUri={RedirectUri} />
                    </Space>
                ) : (
                    <Space className="vert-space" direction="vertical" size="middle">
                        <MarkdownSnippet username={currentUser} />
                        <SpotifyAuthButton clientId={ClientId} redirectUri={RedirectUri} label="Re-authorize" />
                        <Button type="link" danger onClick={handleClearCreds}>
                            Clear local credentials
                        </Button>
                    </Space>
                )}
            </div>
        </div>
    );
}
