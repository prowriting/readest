// A build-time channel: do not infer store policy from device manufacturer or billing availability.
export const isAmazonDistribution = () => process.env['NEXT_PUBLIC_DIST_CHANNEL'] === 'amazon';
