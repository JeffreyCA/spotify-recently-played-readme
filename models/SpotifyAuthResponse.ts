export interface SpotifyAuthResponse {
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    scope: string;
    expires_in: number;
}
