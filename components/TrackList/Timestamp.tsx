import { Typography } from 'antd';
import { DateTime } from 'luxon';

const { Text } = Typography;

interface Props {
    /**
     * ISO date.
     */
    isoDate: string;
}

/**
 * Timestamp component of a track.
 */
export default function Timestamp(props: Props): JSX.Element {
    const { isoDate } = props;

    // Set timestamp text
    const timestampText =
        DateTime.fromISO(isoDate, {
            zone: 'utc',
        }).toRelative({
            style: 'short',
        }) ?? '';

    const timestampTitle = isoDate;

    return (
        <>
            <Text className="timestamp" type="secondary" title={timestampTitle}>
                {timestampText}
            </Text>
        </>
    );
}
