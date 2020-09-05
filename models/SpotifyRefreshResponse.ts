export interface SpotifyRefreshResponse {
    access_token: string;
    token_type: 'Bearer';
    scope: string;
    expires_in: number;
}
