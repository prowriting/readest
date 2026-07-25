import { useTranslation } from '@/hooks/useTranslation';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      <Link
        href='https://bookarc.app/reader-terms'
        className='text-blue-500 underline hover:text-blue-600'
      >
        {_('Terms of Service')}
      </Link>
      <Link
        href='https://bookarc.app/reader-privacy'
        className='text-blue-500 underline hover:text-blue-600'
      >
        {_('Privacy Policy')}
      </Link>
    </div>
  );
};

export default LegalLinks;
