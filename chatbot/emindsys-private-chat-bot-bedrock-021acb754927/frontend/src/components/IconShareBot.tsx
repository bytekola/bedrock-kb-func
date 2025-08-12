import React from 'react';
import { PiGlobe, PiLockKey, PiUsers } from 'react-icons/pi';
import { BaseProps } from '../@types/common';
import { SharedScope } from '../@types/bot';
import { twMerge } from 'tailwind-merge';

type Props = BaseProps & {
  sharedScope: SharedScope;
};

const IconShareBot: React.FC<Props> = (props) => {
  if (props.sharedScope === 'private') {
    return <PiLockKey className={twMerge(props.className)} />;
  } else if (props.sharedScope === 'all') {
    return <PiGlobe className={twMerge(props.className)} />;
  } else {
    return <PiUsers className={twMerge(props.className)} />;
  }
};

export default IconShareBot;
