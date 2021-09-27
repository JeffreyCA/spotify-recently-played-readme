import axios from 'axios';
import qs from 'qs';
import { PlayHistory } from '../models/PlayHistory';
import { RecentlyPlayedResponse } from '../models/RecentlyPlayedResponse';
import { SpotifyAuthResponse } from '../models/SpotifyAuthResponse';
import { SpotifyRefreshResponse } from '../models/SpotifyRefreshResponse';
import { ClientId, RedirectUri } from './Constants';

export function getAuthorizeUri(scopes: string[]): string {
    const spaceSepScopes = scopes.join('%20');
    return `https://accounts.spotify.com/authorize?response_type=code&client_id=${ClientId}&redirect_uri=${RedirectUri}&scope=${spaceSepScopes}&show_dialog=true`;
}

export function getEncodedClientIdAndSecret(): string {
    const clientId = ClientId;
    const clientSecret = process.env.CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('Missing client ID or client secret');
    }

    const encodedString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    return `Basic ${encodedString}`;
}

export async function performAuth(authCode: string): Promise<SpotifyAuthResponse> {
    // Construct Base64 representation of client ID and client secret
    const encodedAuthHeader = getEncodedClientIdAndSecret();
    const result = await axios.post<SpotifyAuthResponse>(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: RedirectUri,
        }),
        {
            headers: {
                Authorization: encodedAuthHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }
    );
    return result.data;
}

export async function getUsername(accessToken: string): Promise<string> {
    const result = await axios.get('https://api.spotify.com/v1/me', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    return result.data.id;
}

export async function getRecentlyPlayed(limit: number, accessToken: string): Promise<PlayHistory[]> {
    const result = await axios.get<RecentlyPlayedResponse>('https://api.spotify.com/v1/me/player/recently-played', {
        params: {
            limit: limit,
        },
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    
    return result.data.items;
}

export async function isValidToken(accessToken: string): Promise<boolean> {
    try {
        await axios.get('https://api.spotify.com/v1/me', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        return true;
    } catch (e) {
        return false;
    }
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
    const encodedAuthHeader = getEncodedClientIdAndSecret();

    const result = await axios.post<SpotifyRefreshResponse>(
        'https://accounts.spotify.com/api/token',
        qs.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
        {
            headers: {
                Authorization: encodedAuthHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }
    );

    return result.data.access_token;
}
