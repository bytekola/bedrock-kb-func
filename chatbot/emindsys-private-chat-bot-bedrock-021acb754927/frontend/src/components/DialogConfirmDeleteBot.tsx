import React from 'react';
import { BaseProps } from '../@types/common';
import Button from './Button';
import ModalDialog from './ModalDialog';
import { Trans, useTranslation } from 'react-i18next';
import { BotMeta } from '../@types/bot';
import Alert from './Alert';
import { isPinnedBot } from '../utils/BotUtils';

type Props = BaseProps & {
  isOpen: boolean;
  target?: BotMeta;
  onDelete: (botId: string) => void;
  onClose: () => void;
};

const DialogConfirmDeleteBot: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  return (
    <ModalDialog {...props} title={t('bot.deleteDialog.title')}>
      {isPinnedBot(props.target?.sharedStatus ?? '') && (
        <div className="mb-2">
          <Alert
            severity="warning"
            title={t('deleteDialog.pinnedBotError.title')}>
            {t('deleteDialog.pinnedBotError.content')}
          </Alert>
        </div>
      )}
      <div>
        <Trans
          i18nKey="bot.deleteDialog.content"
          values={{
            title: props.target?.title,
          }}
          components={{
            Bold: <span className="font-bold" />,
          }}
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={props.onClose} className="p-2" outlined>
          {t('button.cancel')}
        </Button>
        <Button
          disabled={isPinnedBot(props.target?.sharedStatus ?? '')}
          onClick={() => {
            props.onDelete(props.target?.id ?? '');
          }}
          className="bg-red p-2 text-aws-font-color-white-light dark:text-aws-font-color-white-dark">
          {t('button.delete')}
        </Button>
      </div>
    </ModalDialog>
  );
};

export default DialogConfirmDeleteBot;
