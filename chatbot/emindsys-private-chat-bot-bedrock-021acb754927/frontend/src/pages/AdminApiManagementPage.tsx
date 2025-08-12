import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ListItemBot from '../components/ListItemBot';
import { formatDatetime } from '../utils/DateUtils';
import usePublishApiForAdmin from '../hooks/usePublishApiForAdmin';
import { useNavigate } from 'react-router-dom';
import ListPageLayout from '../layouts/ListPageLayout';
import useLoginUser from '../hooks/useLoginUser';

const AdminApiManagementPage: React.FC = () => {
  const { t } = useTranslation();

  const { botApis, isLoading: isLoadingApis } = usePublishApiForAdmin();

  const navigate = useNavigate();

  const onClickViewApi = useCallback(
    (botId: string) => {
      navigate(`/admin/bot/${botId}`);
    },
    [navigate]
  );

  const { userId } = useLoginUser();

  return (
    <ListPageLayout
      pageTitle={t('admin.apiManagement.label.pageTitle')}
      isLoading={isLoadingApis}
      isEmpty={botApis?.length === 0}
      emptyMessage={t('admin.apiManagement.label.noApi')}>
      {botApis?.map((api, idx) => (
        <ListItemBot
          key={idx}
          bot={{
            ...api,
            available: true,
            owned: userId === api.ownerUserId,
          }}
          onClick={() => {
            onClickViewApi(api.id);
          }}>
          <div className="flex flex-col items-end gap-2">
            <div className="text-xs">{api.publishedStackName}</div>
            <div className="text-xs">
              <div className="mr-1 inline font-bold">
                {t('admin.apiManagement.label.publishedDate')}:
              </div>
              {formatDatetime(api.publishedDatetime)}
            </div>
          </div>
        </ListItemBot>
      ))}
    </ListPageLayout>
  );
};

export default AdminApiManagementPage;
